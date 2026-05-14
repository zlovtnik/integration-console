class FingerprintSource < ApplicationRecord
  self.table_name = "sync_scan_ingest"
  self.primary_key = "device_fingerprint"

  FINGERPRINT_SQL = "COALESCE(device_fingerprint, payload->>'device_fingerprint')".freeze
  SOURCE_MAC_SQL = "COALESCE(source_mac, payload->>'source_mac')".freeze
  SSID_SQL = "COALESCE(ssid, payload->>'ssid')".freeze
  BSSID_SQL = "COALESCE(bssid, payload->>'bssid')".freeze
  DESTINATION_BSSID_SQL = "COALESCE(destination_bssid, payload->>'destination_bssid')".freeze
  LOCATION_SQL = "COALESCE(location_id, payload->>'location_id')".freeze
  SENSOR_SQL = "COALESCE(sensor_id, payload->>'sensor_id')".freeze

  scope :wireless, -> { where(stream_name: "wireless.audit") }
  scope :with_fingerprint, -> {
    wireless.where("#{FINGERPRINT_SQL} IS NOT NULL AND #{FINGERPRINT_SQL} != ''")
  }

  scope :search, ->(query) {
    sanitized = query.to_s.strip
    return all if sanitized.blank?

    safe = ActiveRecord::Base.sanitize_sql_like(sanitized)
    where(
      "#{FINGERPRINT_SQL} ILIKE :q OR #{SOURCE_MAC_SQL} ILIKE :q OR #{SSID_SQL} ILIKE :q OR #{BSSID_SQL} ILIKE :q OR #{LOCATION_SQL} ILIKE :q OR #{SENSOR_SQL} ILIKE :q",
      q: "%#{safe}%"
    )
  }

  scope :aggregated, -> {
    with_fingerprint.select(
      "#{FINGERPRINT_SQL} AS device_fingerprint",
      "COUNT(DISTINCT #{SOURCE_MAC_SQL}) AS source_count",
      "ARRAY_AGG(DISTINCT #{SOURCE_MAC_SQL} ORDER BY #{SOURCE_MAC_SQL}) FILTER (WHERE #{SOURCE_MAC_SQL} IS NOT NULL AND #{SOURCE_MAC_SQL} != '') AS source_macs",
      "ARRAY_AGG(DISTINCT #{SSID_SQL} ORDER BY #{SSID_SQL}) FILTER (WHERE #{SSID_SQL} IS NOT NULL AND #{SSID_SQL} != '') AS ssids",
      "ARRAY_AGG(DISTINCT #{BSSID_SQL} ORDER BY #{BSSID_SQL}) FILTER (WHERE #{BSSID_SQL} IS NOT NULL AND #{BSSID_SQL} != '') AS bssids",
      "ARRAY_AGG(DISTINCT #{DESTINATION_BSSID_SQL} ORDER BY #{DESTINATION_BSSID_SQL}) FILTER (WHERE #{DESTINATION_BSSID_SQL} IS NOT NULL AND #{DESTINATION_BSSID_SQL} != '') AS destination_bssids",
      "ARRAY_AGG(DISTINCT #{LOCATION_SQL} ORDER BY #{LOCATION_SQL}) FILTER (WHERE #{LOCATION_SQL} IS NOT NULL AND #{LOCATION_SQL} != '') AS location_ids",
      "ARRAY_AGG(DISTINCT #{SENSOR_SQL} ORDER BY #{SENSOR_SQL}) FILTER (WHERE #{SENSOR_SQL} IS NOT NULL AND #{SENSOR_SQL} != '') AS sensor_ids",
      "MIN(observed_at) AS first_seen",
      "MAX(observed_at) AS last_seen"
    ).group(Arel.sql(FINGERPRINT_SQL))
  }

  # Read aggregated array columns
  def source_mac_list
    Array(read_attribute(:source_macs)).compact
  end

  def ssid_list
    Array(read_attribute(:ssids)).compact
  end

  def bssid_list
    Array(read_attribute(:bssids)).compact
  end

  def destination_bssid_list
    Array(read_attribute(:destination_bssids)).compact
  end

  def location_list
    Array(read_attribute(:location_ids)).compact
  end

  def sensor_list
    Array(read_attribute(:sensor_ids)).compact
  end

  # For DataGrid row rendering
  def as_json(options = {})
    {
      device_fingerprint: device_fingerprint,
      source_count: source_count,
      source_macs: source_mac_list,
      ssids: ssid_list,
      bssids: bssid_list,
      destination_bssids: destination_bssid_list,
      location_ids: location_list,
      sensor_ids: sensor_list,
      first_seen: first_seen,
      last_seen: last_seen
    }
  end
end
