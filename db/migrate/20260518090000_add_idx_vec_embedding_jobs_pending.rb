class AddIdxVecEmbeddingJobsPending < ActiveRecord::Migration[7.0]
  disable_ddl_transaction!

  def up
    execute <<~SQL
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vec_embedding_jobs_pending_priority_due_at
        ON vec_embedding_jobs (priority ASC, due_at ASC, job_id ASC)
        WHERE status IN ('pending', 'failed');
    SQL
  end

  def down
    execute <<~SQL
      DROP INDEX IF EXISTS idx_vec_embedding_jobs_pending_priority_due_at;
    SQL
  end
end
