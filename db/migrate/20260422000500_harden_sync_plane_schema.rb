class HardenSyncPlaneSchema < ActiveRecord::Migration[7.2]
  def change
    add_column :sync_batches, :created_at, :timestamptz, null: false, default: -> { "now()" }, if_not_exists: true
    add_column :sync_batches, :updated_at, :timestamptz, null: false, default: -> { "now()" }, if_not_exists: true

    add_check_constraint :sync_jobs,
      "status IN ('pending','running','completed','failed')",
      name: "chk_sync_jobs_status",
      if_not_exists: true

    add_check_constraint :sync_batches,
      "status IN ('pending','processing','dispatched','completed','failed')",
      name: "chk_sync_batches_status",
      if_not_exists: true

    add_check_constraint :sync_backlog,
      "status IN ('pending','synced','sync_failed','failed')",
      name: "chk_sync_backlog_status",
      if_not_exists: true

    add_foreign_key :sync_jobs,
      :sync_cursors,
      column: :stream_name,
      primary_key: :stream_name,
      name: "fk_sync_jobs_stream_name",
      if_not_exists: true,
      deferrable: :deferred

    add_foreign_key :sync_batches,
      :sync_jobs,
      column: :job_id,
      primary_key: :job_id,
      name: "fk_sync_batches_job_id",
      if_not_exists: true

    add_foreign_key :sync_errors,
      :sync_jobs,
      column: :job_id,
      primary_key: :job_id,
      name: "fk_sync_errors_job_id",
      if_not_exists: true

    add_foreign_key :sync_errors,
      :sync_batches,
      column: :batch_id,
      primary_key: :batch_id,
      name: "fk_sync_errors_batch_id",
      if_not_exists: true

    add_index :sync_jobs, :stream_name, name: "idx_sync_jobs_stream_name", if_not_exists: true
    add_index :sync_jobs, [:status, :created_at], name: "idx_sync_jobs_status_created_at", if_not_exists: true
    add_index :sync_batches, [:job_id, :batch_no], name: "idx_sync_batches_job_batch_no", if_not_exists: true
    add_index :sync_batches, :status, name: "idx_sync_batches_status", if_not_exists: true
    add_index :sync_errors, :job_id, name: "idx_sync_errors_job_id", if_not_exists: true
    add_index :sync_errors, :batch_id, name: "idx_sync_errors_batch_id", if_not_exists: true
    add_index :sensors, :location_id, name: "idx_sensors_location_id", if_not_exists: true
    add_index :sensor_alerts, [:severity, :resolved_at], name: "idx_sensor_alerts_severity_resolved_at", if_not_exists: true
    add_index :redpanda_traffic_samples, [:sensor_id, :sampled_at], name: "idx_redpanda_traffic_samples_sensor_sampled_at", if_not_exists: true

    reversible do |dir|
      dir.up { raise_on_duplicate_open_alerts! }
    end

    add_index :sensor_alerts,
      [:sensor_id, :alert_type],
      unique: true,
      where: "resolved_at IS NULL",
      name: "idx_sensor_alerts_open_unique",
      if_not_exists: true
  end

  private

  def raise_on_duplicate_open_alerts!
    duplicate = select_one(<<~SQL.squish)
      SELECT sensor_id, alert_type, COUNT(*) AS duplicate_count
      FROM sensor_alerts
      WHERE resolved_at IS NULL
      GROUP BY sensor_id, alert_type
      HAVING COUNT(*) > 1
      LIMIT 1
    SQL

    return if duplicate.blank?

    raise ActiveRecord::IrreversibleMigration,
      "Cannot add open alert uniqueness constraint: sensor_id=#{duplicate["sensor_id"]} alert_type=#{duplicate["alert_type"]} has #{duplicate["duplicate_count"]} open rows"
  end
end
