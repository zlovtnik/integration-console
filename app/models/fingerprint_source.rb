class FingerprintSource < ApplicationRecord
  self.table_name = "sync_scan_ingest"
  self.primary_key = "device_fingerprint"

  scope :wireless, -> { where(stream_name: "wireless.audit") }
  scope :with_fingerprint, -> { wireless.where.not(device_fingerprint: [nil, ""]) }

  scope :search, ->(query) {
    sanitized = query.to_s.strip
    return all if sanitized.blank?

    safe = ActiveRecord::Base.sanitize_sql_like(sanitized)
    where(
      "device_fingerprint ILIKE :q OR source_mac ILIKE :q OR ssid ILIKE :q OR bssid ILIKE :q OR location_id ILIKE :q OR sensor_id ILIKE :q",
      q: "%#{safe}%"
    )
  }

  scope :aggregated, -> {
    with_fingerprint.select(
      "device_fingerprint",
      "COUNT(DISTINCT source_mac) AS source_count",
      "ARRAY_AGG(DISTINCT source_mac ORDER BY source_mac) FILTER (WHERE source_mac IS NOT NULL AND source_mac != '') AS source_macs",
      "ARRAY_AGG(DISTINCT ssid ORDER BY ssid) FILTER (WHERE ssid IS NOT NULL AND ssid != '') AS ssids",
      "ARRAY_AGG(DISTINCT bssid ORDER BY bssid) FILTER (WHERE bssid IS NOT NULL AND bssid != '') AS bssids",
      "ARRAY_AGG(DISTINCT destination_bssid ORDER BY destination_bssid) FILTER (WHERE destination_bssid IS NOT NULL AND destination_bssid != '') AS destination_bssids",
      "ARRAY_AGG(DISTINCT location_id ORDER BY location_id) FILTER (WHERE location_id IS NOT NULL AND location_id != '') AS location_ids",
      "ARRAY_AGG(DISTINCT sensor_id ORDER BY sensor_id) FILTER (WHERE sensor_id IS NOT NULL AND sensor_id != '') AS sensor_ids",
      "MIN(first_occurred_at) AS first_seen",
      "MAX(last_occurred_at) AS last_seen"
    ).group(:device_fingerprint)
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