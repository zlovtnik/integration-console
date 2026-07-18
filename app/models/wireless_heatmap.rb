class WirelessHeatmap < SyncRecord
  self.table_name = "mv_wireless_heatmap"
  self.primary_key = "location_id"

  REFRESH_LOCK_KEY = 6_334_815_069_226_278_729

  scope :ordered_by_events, -> { order(event_count: :desc) }

  def self.refresh!
    connection_pool.with_connection do |connection|
      acquired = connection.select_value("SELECT pg_try_advisory_lock(#{REFRESH_LOCK_KEY})")
      return false unless ActiveModel::Type::Boolean.new.cast(acquired)

      begin
        refresh_materialized_view(connection)
        IntegrationConsole::HeatmapCache.bump!
        true
      ensure
        connection.select_value("SELECT pg_advisory_unlock(#{REFRESH_LOCK_KEY})")
      end
    end
  end

  def self.last_refreshed_at
    maximum(:last_seen_at)
  end

  def self.refresh_materialized_view(connection = nil)
    return connection_pool.with_connection { |active_connection| refresh_materialized_view(active_connection) } unless connection

    connection.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY #{connection.quote_table_name(table_name)}")
  rescue ActiveRecord::StatementInvalid => error
    raise unless missing_concurrent_refresh_index?(error)

    Rails.logger.warn(
      "Falling back to non-concurrent wireless heatmap refresh because the materialized view is missing its unique index"
    )
    connection.execute("REFRESH MATERIALIZED VIEW #{connection.quote_table_name(table_name)}")
  end

  def self.missing_concurrent_refresh_index?(error)
    message = error.message
    message.include?("cannot refresh materialized view") &&
      message.include?("concurrently") &&
      message.include?("unique index")
  end
end
