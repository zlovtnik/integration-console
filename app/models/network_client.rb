class NetworkClient < SyncRecord
  self.table_name = "wireless_clients"

  scope :recent, ->(limit = 500) { order(last_seen: :desc, client_mac: :asc, ssid: :asc).limit(limit) }
  scope :search, ->(query) {
    sanitized = ActiveRecord::Base.sanitize_sql_like(query.to_s.strip)
    pattern = "%#{sanitized.downcase}%"
    sanitized.blank? ? all : where(
      "LOWER(ssid) LIKE ? OR LOWER(client_mac) LIKE ? OR LOWER(COALESCE(known_bssid, '')) LIKE ?",
      pattern,
      pattern,
      pattern
    )
  }
end
