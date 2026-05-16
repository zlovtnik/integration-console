class CreateVectorEmbeddingProgressViews < ActiveRecord::Migration[7.2]
  disable_ddl_transaction!

  def up
    execute <<~SQL
      CREATE INDEX CONCURRENTLY IF NOT EXISTS vec_embedding_jobs_status_kind_idx
        ON vec_embedding_jobs (embedding_model, embedding_kind, status)
    SQL

    execute <<~SQL
      CREATE INDEX CONCURRENTLY IF NOT EXISTS vec_embedding_jobs_completed_at_idx
        ON vec_embedding_jobs (completed_at DESC)
        WHERE status = 'completed'
    SQL

    execute <<~SQL
      CREATE OR REPLACE VIEW v_vec_embedding_job_progress AS
      WITH totals AS (
        SELECT
          embedding_model,
          embedding_kind,
          count(*)::bigint AS total_jobs,
          count(*) FILTER (WHERE status = 'pending')::bigint AS pending_jobs,
          count(*) FILTER (WHERE status = 'leased')::bigint AS leased_jobs,
          count(*) FILTER (WHERE status = 'completed')::bigint AS completed_jobs,
          count(*) FILTER (WHERE status = 'failed')::bigint AS failed_jobs,
          count(*) FILTER (WHERE completed_at >= now() - interval '5 minutes')::bigint AS completed_last_5m,
          count(*) FILTER (WHERE completed_at >= now() - interval '15 minutes')::bigint AS completed_last_15m,
          count(*) FILTER (WHERE completed_at >= now() - interval '1 hour')::bigint AS completed_last_1h,
          min(created_at) FILTER (WHERE status in ('pending', 'leased')) AS oldest_remaining_at,
          max(completed_at) AS latest_completed_at
        FROM vec_embedding_jobs
        GROUP BY ROLLUP (embedding_model, embedding_kind)
        HAVING embedding_model IS NOT NULL
      )
      SELECT
        embedding_model,
        coalesce(embedding_kind, 'all') AS embedding_kind,
        total_jobs,
        pending_jobs,
        leased_jobs,
        completed_jobs,
        failed_jobs,
        pending_jobs + leased_jobs AS remaining_jobs,
        round((completed_jobs::numeric / nullif(total_jobs, 0)) * 100.0, 2) AS progress_percent,
        completed_last_5m,
        completed_last_15m,
        completed_last_1h,
        round(completed_last_15m::numeric / 15.0, 2) AS jobs_per_minute_15m,
        CASE
          WHEN completed_last_15m > 0 AND pending_jobs + leased_jobs > 0 THEN
            now() + (((pending_jobs + leased_jobs)::double precision / (completed_last_15m::double precision / 15.0)) * interval '1 minute')
        END AS eta_at,
        oldest_remaining_at,
        latest_completed_at
      FROM totals;
    SQL

    execute <<~SQL
      CREATE OR REPLACE VIEW v_vec_embedding_worker_progress AS
      SELECT
        worker.worker_name,
        worker.status,
        worker.last_cursor,
        worker.last_run_started_at,
        worker.last_run_finished_at,
        worker.rows_processed,
        worker.last_error,
        worker.updated_at,
        now() - worker.updated_at AS heartbeat_age,
        count(job.job_id)::bigint AS leased_jobs,
        min(job.leased_at) AS oldest_lease_at,
        max(job.leased_at) AS newest_lease_at,
        max(now() - job.leased_at) AS oldest_lease_age,
        worker.status = 'running' AND worker.updated_at < now() - interval '2 minutes' AS stale_heartbeat
      FROM vec_worker_state worker
      LEFT JOIN vec_embedding_jobs job
        ON job.locked_by = worker.worker_name
       AND job.status = 'leased'
      GROUP BY
        worker.worker_name,
        worker.status,
        worker.last_cursor,
        worker.last_run_started_at,
        worker.last_run_finished_at,
        worker.rows_processed,
        worker.last_error,
        worker.updated_at;
    SQL
  end

  def down
    execute "DROP VIEW IF EXISTS v_vec_embedding_worker_progress"
    execute "DROP VIEW IF EXISTS v_vec_embedding_job_progress"
    execute "DROP INDEX CONCURRENTLY IF EXISTS vec_embedding_jobs_completed_at_idx"
    execute "DROP INDEX CONCURRENTLY IF EXISTS vec_embedding_jobs_status_kind_idx"
  end
end
