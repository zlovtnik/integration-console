class BacklogStatus < SyncRecord
  self.table_name = "sync_backlog"
  self.primary_key = "dedupe_key"

  scope :pending, -> { where(status: "pending") }
  scope :failed, -> { where(status: "sync_failed").or(where(status: "failed")) }
  scope :ordered_by_updated, -> { order(updated_at: :asc) }

  def self.pending_count = pending.count
  def self.failed_count = failed.count

  def self.status_counts
    counts = select(
      "SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count",
      "SUM(CASE WHEN status IN ('sync_failed','failed') THEN 1 ELSE 0 END) AS failed_count"
    ).take

    {
      pending_count: counts.pending_count.to_i,
      failed_count: counts.failed_count.to_i
    }
  end
end
