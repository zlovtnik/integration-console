class ShadowItAlert < SyncRecord
  self.table_name = "v_wireless_shadow_alerts"
  self.primary_key = "alert_id"

  scope :recent, -> { order(last_occurred_at: :desc) }
  scope :open, -> { where(resolved_at: nil) }
  scope :search, ->(query) {
    query.blank? ? none : where(
      "LOWER(source_mac) LIKE :q OR LOWER(COALESCE(destination_bssid, '')) LIKE :q OR LOWER(COALESCE(ssid, '')) LIKE :q OR LOWER(COALESCE(sensor_id, '')) LIKE :q OR LOWER(COALESCE(location_id, '')) LIKE :q OR LOWER(reason) LIKE :q",
      q: "%#{sanitize_sql_like(query.to_s.downcase)}%"
    )
  }

  def evidence_value(key)
    evidence.is_a?(Hash) ? evidence[key.to_s] : nil
  end
end
