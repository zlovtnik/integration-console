class AddHeatmapSortIndexes < ActiveRecord::Migration[7.2]
  disable_ddl_transaction!

  def up
    execute <<~SQL
      CREATE INDEX CONCURRENTLY IF NOT EXISTS mv_wireless_heatmap_events_idx
        ON mv_wireless_heatmap (event_count DESC, last_seen_at DESC)
    SQL

    execute <<~SQL
      CREATE INDEX CONCURRENTLY IF NOT EXISTS mv_wireless_heatmap_last_seen_idx
        ON mv_wireless_heatmap (last_seen_at DESC)
    SQL
  end

  def down
    execute "DROP INDEX CONCURRENTLY IF EXISTS mv_wireless_heatmap_events_idx"
    execute "DROP INDEX CONCURRENTLY IF EXISTS mv_wireless_heatmap_last_seen_idx"
  end
end