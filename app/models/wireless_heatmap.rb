class WirelessHeatmap < SyncRecord
  self.table_name = "mv_wireless_heatmap"
  self.primary_key = "location_id"

  scope :ordered_by_events, -> { order(event_count: :desc) }

  def self.refresh!
    raise ActiveRecord::ReadOnlyRecord, "Wireless heatmap is maintained by Octopus"
  end

  def self.last_refreshed_at
    maximum(:last_seen_at)
  end

end
