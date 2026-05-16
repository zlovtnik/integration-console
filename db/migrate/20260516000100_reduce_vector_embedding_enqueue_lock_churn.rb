class ReduceVectorEmbeddingEnqueueLockChurn < ActiveRecord::Migration[7.2]
  def up
    execute enqueue_function_sql
  end

  def down
    raise ActiveRecord::IrreversibleMigration
  end

  private

  def enqueue_function_sql
    <<~SQL
      create or replace function vec_enqueue_embedding_jobs(
        p_model text default 'nomic-embed-text-v2-moe'
      )
      returns integer
      language plpgsql
      as $$
      declare
        v_count integer := 0;
      begin
        with cursor_state as (
          select coalesce(
            (select cursor_value::timestamptz
               from sync_cursor
              where stream_name = 'vec_embeddings.sync_scan_ingest.wireless.audit'),
            timestamptz '1970-01-01 00:00:00+00'
          ) as last_cursor
        ),
        event_jobs as (
          select
            'sync_scan_ingest'::text as source_table,
            dedupe_key::text as source_key,
            p_model as embedding_model,
            'event'::text as embedding_kind,
            10 as priority
          from sync_scan_ingest source
          cross join cursor_state cursor_state
          left join vec_embeddings existing
            on existing.source_table = 'sync_scan_ingest'
           and existing.source_key = source.dedupe_key
           and existing.embedding_model = p_model
           and existing.embedding_kind = 'event'
          where stream_name = 'wireless.audit'
            and (
              existing.embedding_id is null
              or source.updated_at > existing.embedded_at
              or (
                source.status = 'batched'
                and source.updated_at > cursor_state.last_cursor
              )
            )
        ),
        device_jobs as (
          select
            'devices'::text as source_table,
            mac_id::text as source_key,
            p_model as embedding_model,
            'device'::text as embedding_kind,
            30 as priority
          from devices source
          left join vec_embeddings existing
            on existing.source_table = 'devices'
           and existing.source_key = source.mac_id
           and existing.embedding_model = p_model
           and existing.embedding_kind = 'device'
          where existing.embedding_id is null
             or source.last_seen > existing.embedded_at
        ),
        behaviour_jobs as (
          select
            'vec_behaviour_snapshots'::text as source_table,
            snapshot_id::text as source_key,
            p_model as embedding_model,
            'behaviour_window'::text as embedding_kind,
            20 as priority
          from vec_behaviour_snapshots source
          left join vec_embeddings existing
            on existing.source_table = 'vec_behaviour_snapshots'
           and existing.source_key = source.snapshot_id::text
           and existing.embedding_model = p_model
           and existing.embedding_kind = 'behaviour_window'
          where existing.embedding_id is null
             or source.updated_at > existing.embedded_at
        ),
        inserted as (
          insert into vec_embedding_jobs (
            source_table, source_key, embedding_model, embedding_kind, priority, status, due_at, created_at, updated_at
          )
          select source_table, source_key, embedding_model, embedding_kind, priority, 'pending', now(), now(), now()
          from (
            select * from event_jobs
            union all
            select * from device_jobs
            union all
            select * from behaviour_jobs
          ) jobs
          on conflict (source_table, source_key, embedding_model, embedding_kind) do update set
            status = 'pending',
            due_at = least(vec_embedding_jobs.due_at, now()),
            priority = least(vec_embedding_jobs.priority, excluded.priority),
            completed_at = null,
            content_sha256 = null,
            updated_at = now()
          where vec_embedding_jobs.status = 'completed'
          returning 1
        )
        select count(*) into v_count from inserted;

        insert into sync_cursor (stream_name, cursor_value, updated_at)
        select
          'vec_embeddings.sync_scan_ingest.wireless.audit',
          coalesce(max(updated_at)::text, now()::text),
          now()
        from sync_scan_ingest
        where stream_name = 'wireless.audit'
        on conflict (stream_name) do update set
          cursor_value = greatest(sync_cursor.cursor_value::timestamptz, excluded.cursor_value::timestamptz)::text,
          updated_at = now();

        return v_count;
      end;
      $$;
    SQL
  end
end
