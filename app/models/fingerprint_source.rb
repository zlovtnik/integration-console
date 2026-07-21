class FingerprintSource < SyncRecord
  self.table_name = "sync_events"
  self.primary_key = "device_fingerprint"

  FINGERPRINT_SQL = "COALESCE(device_fingerprint, JSON_UNQUOTE(JSON_EXTRACT(payload, '$.device_fingerprint')))".freeze
  SOURCE_MAC_SQL = "COALESCE(source_mac, JSON_UNQUOTE(JSON_EXTRACT(payload, '$.source_mac')))".freeze
  SSID_SQL = "COALESCE(ssid, JSON_UNQUOTE(JSON_EXTRACT(payload, '$.ssid')))".freeze
  BSSID_SQL = "COALESCE(bssid, JSON_UNQUOTE(JSON_EXTRACT(payload, '$.bssid')))".freeze
  DESTINATION_BSSID_SQL = "COALESCE(destination_bssid, JSON_UNQUOTE(JSON_EXTRACT(payload, '$.destination_bssid')))".freeze
  LOCATION_SQL = "COALESCE(location_id, JSON_UNQUOTE(JSON_EXTRACT(payload, '$.location_id')))".freeze
  SENSOR_SQL = "COALESCE(sensor_id, JSON_UNQUOTE(JSON_EXTRACT(payload, '$.sensor_id')))".freeze

  scope :wireless, -> { where(stream_name: "wireless.audit") }
  scope :with_fingerprint, -> {
    wireless.where("#{FINGERPRINT_SQL} IS NOT NULL AND #{FINGERPRINT_SQL} != ''")
  }

  scope :search, ->(query) {
    sanitized = query.to_s.strip
    return all if sanitized.blank?

    safe = ActiveRecord::Base.sanitize_sql_like(sanitized)
    where(
      "LOWER(#{FINGERPRINT_SQL}) LIKE :q OR LOWER(#{SOURCE_MAC_SQL}) LIKE :q OR LOWER(#{SSID_SQL}) LIKE :q OR LOWER(#{BSSID_SQL}) LIKE :q OR LOWER(#{LOCATION_SQL}) LIKE :q OR LOWER(#{SENSOR_SQL}) LIKE :q",
      q: "%#{safe.downcase}%"
    )
  }

  scope :aggregated, -> {
    with_fingerprint.select(
      "#{FINGERPRINT_SQL} AS device_fingerprint",
      "COUNT(DISTINCT #{SOURCE_MAC_SQL}) AS source_count",
      "GROUP_CONCAT(DISTINCT NULLIF(#{SOURCE_MAC_SQL}, '') ORDER BY #{SOURCE_MAC_SQL} SEPARATOR ',') AS source_macs",
      "GROUP_CONCAT(DISTINCT NULLIF(#{SSID_SQL}, '') ORDER BY #{SSID_SQL} SEPARATOR ',') AS ssids",
      "GROUP_CONCAT(DISTINCT NULLIF(#{BSSID_SQL}, '') ORDER BY #{BSSID_SQL} SEPARATOR ',') AS bssids",
      "GROUP_CONCAT(DISTINCT NULLIF(#{DESTINATION_BSSID_SQL}, '') ORDER BY #{DESTINATION_BSSID_SQL} SEPARATOR ',') AS destination_bssids",
      "GROUP_CONCAT(DISTINCT NULLIF(#{LOCATION_SQL}, '') ORDER BY #{LOCATION_SQL} SEPARATOR ',') AS location_ids",
      "GROUP_CONCAT(DISTINCT NULLIF(#{SENSOR_SQL}, '') ORDER BY #{SENSOR_SQL} SEPARATOR ',') AS sensor_ids",
      "MIN(observed_at) AS first_seen",
      "MAX(observed_at) AS last_seen"
    ).group(Arel.sql(FINGERPRINT_SQL))
  }

  # Read aggregated array columns
  def source_mac_list
    list_attribute(:source_macs)
  end

  def ssid_list
    list_attribute(:ssids)
  end

  def bssid_list
    list_attribute(:bssids)
  end

  def destination_bssid_list
    list_attribute(:destination_bssids)
  end

  def location_list
    list_attribute(:location_ids)
  end

  def sensor_list
    list_attribute(:sensor_ids)
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

  private

  def list_attribute(name)
    value = read_attribute(name)
    value.is_a?(Array) ? value.compact : value.to_s.split(",").reject(&:empty?)
  end
end
