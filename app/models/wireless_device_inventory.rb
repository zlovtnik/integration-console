class WirelessDeviceInventory < SyncRecord
  self.table_name = "v_wireless_device_inventory"
  self.primary_key = "source_mac"

  scope :recent, -> { order(last_occurred_at: :desc) }
  scope :search, ->(query) {
    query.blank? ? none : where(
      "LOWER(source_mac) LIKE :q OR LOWER(COALESCE(location_id, '')) LIKE :q OR LOWER(COALESCE(sensor_id, '')) LIKE :q OR LOWER(COALESCE(ssid, '')) LIKE :q OR LOWER(COALESCE(destination_bssid, '')) LIKE :q OR LOWER(COALESCE(ip_addresses, '')) LIKE :q OR LOWER(COALESCE(hostnames, '')) LIKE :q OR LOWER(COALESCE(services, '')) LIKE :q OR LOWER(COALESCE(dns_names, '')) LIKE :q OR LOWER(COALESCE(registered_username, '')) LIKE :q OR LOWER(COALESCE(display_name, '')) LIKE :q",
      q: "%#{sanitize_sql_like(query.to_s.downcase)}%"
    )
  }
end
