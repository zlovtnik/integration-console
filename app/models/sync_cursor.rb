class SyncCursor < SyncRecord
  self.table_name = "sync_cursors"
  self.primary_key = "stream_name"
end
