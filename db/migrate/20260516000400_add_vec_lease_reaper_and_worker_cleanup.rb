class AddVecLeaseReaperAndWorkerCleanup < ActiveRecord::Migration[7.2]
  def up
    # Add 'stale' as a valid status for vec_worker_state (it was previously
    # unconstrained). Drop and recreate the column's default since we want
    # to enforce valid statuses going forward.
    execute <<~SQL
      ALTER TABLE vec_worker_state
        ADD CONSTRAINT vec_worker_state_status_chk
          CHECK (status IN ('idle', 'running', 'failed', 'stale'))
          NOT VALID
    SQL

    # Create the lease reaper function — releases jobs whose leases have
    # expired (worker died mid-batch). Matches the 30-minute default from
    # VECTOR_EMBEDDING_LEASE_SECONDS=1800.
    execute <<~SQL
      CREATE OR REPLACE FUNCTION vec_release_expired_leases(
        p_lease_interval interval DEFAULT interval '30 minutes'
      )
      RETURNS integer
      LANGUAGE plpgsql
      AS $$
      DECLARE
        v_count integer;
      BEGIN
        UPDATE vec_embedding_jobs
           SET status = 'pending',
               lease_token = NULL,
               leased_at = NULL,
               locked_by = NULL,
               due_at = now(),
               last_error = 'lease expired',
               updated_at = now()
         WHERE status = 'leased'
           AND leased_at < now() - p_lease_interval;

        GET DIAGNOSTICS v_count = ROW_COUNT;
        RETURN v_count;
      END;
      $$;
    SQL

    # Create the stale worker reaper — marks worker rows as 'stale' when
    # their heartbeat (updated_at) hasn't been seen for p_stale_after.
    execute <<~SQL
      CREATE OR REPLACE FUNCTION vec_reap_stale_workers(
        p_stale_after interval DEFAULT interval '5 minutes'
      )
      RETURNS integer
      LANGUAGE plpgsql
      AS $$
      DECLARE
        v_count integer;
      BEGIN
        UPDATE vec_worker_state
           SET status = 'stale',
               updated_at = now()
         WHERE status = 'running'
           AND updated_at < now() - p_stale_after;

        GET DIAGNOSTICS v_count = ROW_COUNT;
        RETURN v_count;
      END;
      $$;
    SQL

    # Register the cron jobs. pg_cron must already be installed (it is, via
    # the vector foundation migration).
    execute <<~SQL
      SELECT cron.schedule(
        'vec-release-expired-leases',
        '* * * * *',
        $cron$SELECT vec_release_expired_leases();$cron$
      );
    SQL

    execute <<~SQL
      SELECT cron.schedule(
        'vec-reap-stale-workers',
        '*/5 * * * *',
        $cron$SELECT vec_reap_stale_workers();$cron$
      );
    SQL
  end

  def down
    execute <<~SQL
      DO $$
      BEGIN
        IF to_regnamespace('cron') IS NOT NULL THEN
          PERFORM cron.unschedule('vec-release-expired-leases');
          PERFORM cron.unschedule('vec-reap-stale-workers');
        END IF;
      EXCEPTION
        WHEN undefined_function THEN
          NULL;
      END $$;
    SQL

    execute <<~SQL
      DROP FUNCTION IF EXISTS vec_release_expired_leases(interval);
    SQL

    execute <<~SQL
      DROP FUNCTION IF EXISTS vec_reap_stale_workers(interval);
    SQL

    execute <<~SQL
      ALTER TABLE vec_worker_state
        DROP CONSTRAINT IF EXISTS vec_worker_state_status_chk
    SQL
  end
end