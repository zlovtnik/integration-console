class SyncPlaneHealth < SyncRecord
  self.table_name = "v_sync_plane_health"
  self.primary_key = nil

  IMPORTANT_RELATIONS = {
    "sync_events" => "Wireless audit events",
    "sync_jobs" => "Coordinator jobs",
    "sync_batches" => "Oracle load batches",
    "sync_backlog" => "Sensor publish backlog",
    "wireless_shadow_alerts" => "Shadow IT alerts",
    "sync_cursors" => "Stream cursors",
    "sync_errors" => "Sync errors",
    "devices" => "Registered MAC identifiers",
    "wireless_authorized_networks" => "Allowed wireless networks"
  }.freeze

  DEFAULT_ATTRIBUTES = {
    "measured_at" => nil,
    "wireless_last_observed_at" => nil,
    "last_shadow_it_alert_at" => nil,
    "wireless_cursor_value" => nil,
    "wireless_cursor_updated_at" => nil,
    "wireless_events_24h_count" => 0,
    "wireless_ingest_pending_count" => 0,
    "wireless_ingest_processing_count" => 0,
    "wireless_ingest_batched_count" => 0,
    "wireless_ingest_failed_count" => 0,
    "wireless_ingest_total_count" => 0,
    "ingest_pending_count" => 0,
    "ingest_processing_count" => 0,
    "ingest_batched_count" => 0,
    "ingest_failed_count" => 0,
    "ingest_total_count" => 0,
    "batch_pending_count" => 0,
    "batch_processing_count" => 0,
    "batch_dispatched_count" => 0,
    "batch_completed_count" => 0,
    "batch_failed_count" => 0,
    "batch_total_count" => 0,
    "job_stored_pending_count" => 0,
    "job_stored_running_count" => 0,
    "job_stored_completed_count" => 0,
    "job_stored_failed_count" => 0,
    "job_total_count" => 0,
    "job_effective_pending_count" => 0,
    "job_effective_running_count" => 0,
    "job_effective_completed_count" => 0,
    "job_effective_failed_count" => 0,
    "job_orphaned_count" => 0,
    "backlog_pending_count" => 0,
    "backlog_failed_count" => 0,
    "open_shadow_it_alert_count" => 0
  }.freeze

  Snapshot = Struct.new(*DEFAULT_ATTRIBUTES.keys.map(&:to_sym), keyword_init: true) do
    def attributes
      to_h.stringify_keys
    end
  end

  def self.snapshot
    from_attributes(first&.attributes)
  rescue ActiveRecord::StatementInvalid => error
    raise unless missing_health_view?(error)

    default_snapshot
  end

  def self.from_attributes(attributes)
    normalized = DEFAULT_ATTRIBUTES.merge((attributes || {}).stringify_keys)
    Snapshot.new(**normalized.symbolize_keys)
  end

  def self.important_relations
    quoted_names = IMPORTANT_RELATIONS.keys.map { |name| connection.quote(name) }.join(", ")
    rows = connection.exec_query(<<~SQL.squish)
      SELECT
        table_name AS name,
        CASE table_type
          WHEN 'BASE TABLE' THEN 'table'
          WHEN 'VIEW' THEN 'view'
          ELSE LOWER(table_type)
        END AS kind,
        COALESCE(table_rows, 0) AS estimated_rows,
        COALESCE(data_length, 0) + COALESCE(index_length, 0) AS total_bytes
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name IN (#{quoted_names})
      ORDER BY FIELD(table_name, #{quoted_names})
    SQL

    rows.map do |row|
      row.symbolize_keys.merge(
        role: IMPORTANT_RELATIONS.fetch(row.fetch("name")),
        total_size: format_bytes(row.fetch("total_bytes").to_i)
      )
    end
  end

  def self.default_snapshot
    from_attributes(DEFAULT_ATTRIBUTES)
  end

  def self.missing_health_view?(error)
    error.message.include?(table_name)
  end
  private_class_method :default_snapshot, :missing_health_view?

  def self.format_bytes(bytes)
    units = %w[B KB MB GB TB]
    value = bytes.to_f
    unit_index = 0

    while value >= 1024 && unit_index < units.length - 1
      value /= 1024
      unit_index += 1
    end

    unit_index.zero? ? "#{bytes} B" : "#{value.round(1)} #{units[unit_index]}"
  end
  private_class_method :format_bytes
end
