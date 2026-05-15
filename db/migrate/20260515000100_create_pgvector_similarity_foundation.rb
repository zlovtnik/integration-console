class CreatePgvectorSimilarityFoundation < ActiveRecord::Migration[7.2]
  def up
    execute vector_foundation_sql
  end

  def down
    execute <<~SQL
      DO $$
      BEGIN
        IF to_regnamespace('cron') IS NOT NULL THEN
          PERFORM cron.unschedule('vec-materialize-similarity-pairs');
          PERFORM cron.unschedule('vec-enqueue-embedding-jobs');
          PERFORM cron.unschedule('vec-build-behaviour-snapshots');
        END IF;
      EXCEPTION
        WHEN undefined_function THEN
          NULL;
      END $$;

      DROP VIEW IF EXISTS v_vec_similarity_audit;
      DROP FUNCTION IF EXISTS vec_install_cron_jobs();
      DROP FUNCTION IF EXISTS vec_materialize_similarity_pairs(text, integer, double precision, double precision);
      DROP FUNCTION IF EXISTS vec_lease_embedding_jobs(integer, text, interval);
      DROP FUNCTION IF EXISTS vec_enqueue_embedding_jobs(text);
      DROP FUNCTION IF EXISTS vec_build_behaviour_snapshots(timestamptz, timestamptz, interval);
      DROP TABLE IF EXISTS vec_embedding_jobs;
      DROP TABLE IF EXISTS vec_worker_state;
      DROP TABLE IF EXISTS vec_similarity_pairs;
      DROP TABLE IF EXISTS vec_embeddings;
      DROP TABLE IF EXISTS vec_behaviour_snapshots;
    SQL
  end

  private

  def vector_foundation_sql
    path = vector_foundation_source_path
    body = File.read(path)
    match = body.match(/-- vec similarity foundation begin\n(?<sql>.*)\n-- vec similarity foundation end/m)
    raise "vector foundation SQL markers not found in #{path}" unless match

    match[:sql]
  end

  def vector_foundation_source_path
    candidates = [
      Rails.root.join("db/sql/coordinator_postgres.sql"),
      Rails.root.join("..", "..", "services", "zig-coordinator", "schema", "postgres.sql")
    ]
    candidates.find { |path| File.exist?(path) } || raise("coordinator postgres schema not found")
  end
end
