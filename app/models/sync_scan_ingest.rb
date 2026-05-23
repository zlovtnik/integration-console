class SyncScanIngest < SyncRecord
  self.table_name = "sync_events"
  self.primary_key = "dedupe_key"
end
