class AddEmbeddingTextToBehaviourSnapshots < ActiveRecord::Migration[7.2]
  def up
    # Add the identity-stripped embedding_text column (nullable; populated by
    # the next vec_build_behaviour_snapshots cron run).
    execute <<~SQL
      ALTER TABLE vec_behaviour_snapshots
        ADD COLUMN IF NOT EXISTS embedding_text text
    SQL

    # Re-enqueue all existing event and behaviour_window embedding jobs so the
    # worker regenerates them with the new identity-stripped content_text.
    # Device embeddings are unchanged (they are identity by nature).
    execute <<~SQL
      UPDATE vec_embedding_jobs
        SET status = 'pending',
            due_at = now(),
            completed_at = NULL,
            content_sha256 = NULL,
            lease_token = NULL,
            leased_at = NULL,
            locked_by = NULL,
            last_error = NULL,
            updated_at = now()
        WHERE embedding_kind IN ('event', 'behaviour_window')
          AND status = 'completed'
    SQL
  end

  def down
    execute <<~SQL
      ALTER TABLE vec_behaviour_snapshots
        DROP COLUMN IF EXISTS embedding_text
    SQL
  end
end