class FixVecCompleteEmbeddingBatchLocking < ActiveRecord::Migration[7.2]
  def up
    execute <<~SQL
      CREATE OR REPLACE FUNCTION vec_complete_embedding_batch(p_payload jsonb)
      RETURNS integer
      LANGUAGE plpgsql
      AS $$
      DECLARE
        v_count integer;
      BEGIN
        IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'array' OR jsonb_array_length(p_payload) = 0 THEN
          RETURN 0;
        END IF;

        WITH payload_rows AS MATERIALIZED (
          -- Parse the payload once and reuse the rows for both statements.
          SELECT
            r.job_id,
            r.lease_token,
            r.source_table,
            r.source_key,
            r.source_observed_at,
            r.source_stream_name,
            r.source_sensor_id,
            r.source_location_id,
            r.source_mac,
            r.embedding_model,
            r.embedding_kind,
            r.embedding_dimensions,
            r.content_sha256,
            r.content_text,
            r.embedding,
            COALESCE(r.metadata, '{}'::jsonb) AS metadata
          FROM jsonb_to_recordset(p_payload) AS r(
            job_id bigint,
            lease_token text,
            source_table text,
            source_key text,
            source_observed_at timestamptz,
            source_stream_name text,
            source_sensor_id text,
            source_location_id text,
            source_mac text,
            embedding_model text,
            embedding_kind text,
            embedding_dimensions integer,
            content_sha256 text,
            content_text text,
            embedding text,
            metadata jsonb
          )
          ORDER BY
            r.source_table,
            r.source_key,
            r.embedding_model,
            r.embedding_kind,
            r.job_id
        ),
        inserted AS (
          INSERT INTO vec_embeddings (
            source_table, source_key, source_observed_at, source_stream_name,
            source_sensor_id, source_location_id, source_mac,
            embedding_model, embedding_kind, embedding_dimensions,
            content_sha256, content_text, embedding, metadata,
            embedded_at, created_at, updated_at
          )
          SELECT
            p.source_table,
            p.source_key,
            p.source_observed_at,
            p.source_stream_name,
            p.source_sensor_id,
            p.source_location_id,
            p.source_mac,
            p.embedding_model,
            p.embedding_kind,
            p.embedding_dimensions,
            p.content_sha256,
            p.content_text,
            p.embedding::vector,
            p.metadata,
            now(), now(), now()
          FROM payload_rows p
          ORDER BY
            p.source_table,
            p.source_key,
            p.embedding_model,
            p.embedding_kind,
            p.job_id
          ON CONFLICT (source_table, source_key, embedding_model, embedding_kind)
          DO UPDATE SET
            source_observed_at = EXCLUDED.source_observed_at,
            source_stream_name = EXCLUDED.source_stream_name,
            source_sensor_id = EXCLUDED.source_sensor_id,
            source_location_id = EXCLUDED.source_location_id,
            source_mac = EXCLUDED.source_mac,
            embedding_dimensions = EXCLUDED.embedding_dimensions,
            content_sha256 = EXCLUDED.content_sha256,
            content_text = EXCLUDED.content_text,
            embedding = EXCLUDED.embedding,
            metadata = EXCLUDED.metadata,
            embedded_at = now(),
            updated_at = now()
          RETURNING 1
        ),
        locked AS (
          -- Lock job rows in the same key order as vec_lease_embedding_jobs.
          SELECT
            j.job_id,
            p.lease_token,
            p.content_sha256
          FROM vec_embedding_jobs j
          JOIN payload_rows p
            ON p.job_id = j.job_id
          WHERE j.lease_token IS NOT DISTINCT FROM p.lease_token
          ORDER BY j.job_id ASC
          FOR UPDATE
        ),
        updated AS (
          UPDATE vec_embedding_jobs j
             SET status = 'completed',
                 content_sha256 = locked.content_sha256,
                 completed_at = now(),
                 lease_token = NULL,
                 leased_at = NULL,
                 locked_by = NULL,
                 last_error = NULL,
                 updated_at = now()
            FROM locked
           WHERE j.job_id = locked.job_id
             AND j.lease_token IS NOT DISTINCT FROM locked.lease_token
          RETURNING 1
        )
        SELECT COUNT(*) INTO v_count FROM updated;

        RETURN v_count;
      END;
      $$;
    SQL
  end

  def down
    execute <<~SQL
      CREATE OR REPLACE FUNCTION vec_complete_embedding_batch(p_payload jsonb)
      RETURNS integer
      LANGUAGE plpgsql
      AS $$
      DECLARE
        v_count integer;
      BEGIN
        IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'array' OR jsonb_array_length(p_payload) = 0 THEN
          RETURN 0;
        END IF;

        INSERT INTO vec_embeddings (
          source_table, source_key, source_observed_at, source_stream_name,
          source_sensor_id, source_location_id, source_mac,
          embedding_model, embedding_kind, embedding_dimensions,
          content_sha256, content_text, embedding, metadata,
          embedded_at, created_at, updated_at
        )
        SELECT
          r.source_table,
          r.source_key,
          r.source_observed_at,
          r.source_stream_name,
          r.source_sensor_id,
          r.source_location_id,
          r.source_mac,
          r.embedding_model,
          r.embedding_kind,
          r.embedding_dimensions,
          r.content_sha256,
          r.content_text,
          r.embedding::vector,
          COALESCE(r.metadata, '{}'::jsonb),
          now(), now(), now()
        FROM jsonb_to_recordset(p_payload) AS r(
          job_id bigint,
          lease_token text,
          source_table text,
          source_key text,
          source_observed_at timestamptz,
          source_stream_name text,
          source_sensor_id text,
          source_location_id text,
          source_mac text,
          embedding_model text,
          embedding_kind text,
          embedding_dimensions integer,
          content_sha256 text,
          content_text text,
          embedding text,
          metadata jsonb
        )
        ON CONFLICT (source_table, source_key, embedding_model, embedding_kind)
        DO UPDATE SET
          source_observed_at = EXCLUDED.source_observed_at,
          source_stream_name = EXCLUDED.source_stream_name,
          source_sensor_id = EXCLUDED.source_sensor_id,
          source_location_id = EXCLUDED.source_location_id,
          source_mac = EXCLUDED.source_mac,
          embedding_dimensions = EXCLUDED.embedding_dimensions,
          content_sha256 = EXCLUDED.content_sha256,
          content_text = EXCLUDED.content_text,
          embedding = EXCLUDED.embedding,
          metadata = EXCLUDED.metadata,
          embedded_at = now(),
          updated_at = now();

        UPDATE vec_embedding_jobs j
           SET status = 'completed',
               content_sha256 = r.content_sha256,
               completed_at = now(),
               lease_token = NULL,
               leased_at = NULL,
               locked_by = NULL,
               last_error = NULL,
               updated_at = now()
          FROM jsonb_to_recordset(p_payload) AS r(
            job_id bigint,
            lease_token text,
            content_sha256 text
          )
         WHERE j.job_id = r.job_id
           AND j.lease_token IS NOT DISTINCT FROM r.lease_token;

        GET DIAGNOSTICS v_count = ROW_COUNT;
        RETURN v_count;
      END;
      $$;
    SQL
  end
end
