require "test_helper"
require Rails.root.join("db/migrate/20260515000100_create_pgvector_similarity_foundation").to_s
require Rails.root.join("db/migrate/20260516000100_reduce_vector_embedding_enqueue_lock_churn").to_s

class PgvectorSimilarityFoundationTest < ActiveSupport::TestCase
  test "migration source includes required vector objects" do
    migration = CreatePgvectorSimilarityFoundation.new
    sql = migration.send(:vector_foundation_sql)

    assert_includes sql, "create extension if not exists vector"
    assert_includes sql, "create extension if not exists pg_cron"
    assert_includes sql, "create table if not exists vec_embeddings"
    assert_includes sql, "create table if not exists vec_similarity_pairs"
    assert_includes sql, "create table if not exists vec_behaviour_snapshots"
    assert_includes sql, "create table if not exists vec_embedding_jobs"
    assert_includes sql, "create table if not exists vec_worker_state"
    assert_includes sql, "create or replace view v_vec_similarity_audit"
    assert_includes sql, "vec_install_cron_jobs"
    assert_includes sql, "vector_cosine_ops"
  end

  test "enqueue lock churn migration only rewrites completed jobs" do
    migration = ReduceVectorEmbeddingEnqueueLockChurn.new
    sql = migration.send(:enqueue_function_sql)

    assert_includes sql, "where vec_embedding_jobs.status = 'completed'"
    assert_no_match(/when vec_embedding_jobs\.status = 'leased'/, sql)
  end
end
