require "test_helper"

class WirelessHeatmapTest < ActiveSupport::TestCase
  class MissingConcurrentIndexConnection
    attr_reader :statements

    def initialize
      @statements = []
    end

    def execute(statement)
      statements << statement
      return true unless statement == "REFRESH MATERIALIZED VIEW CONCURRENTLY \"mv_wireless_heatmap\""

      raise ActiveRecord::StatementInvalid, <<~MSG.squish
        PG::ObjectNotInPrerequisiteState: ERROR: cannot refresh materialized view "public.mv_wireless_heatmap" concurrently
        HINT: Create a unique index with no WHERE clause on one or more columns of the materialized view.
      MSG
    end

    def select_value(statement)
      statements << statement
      true
    end

    def quote_table_name(name)
      %("#{name}")
    end
  end

  class FakeConnectionPool
    def initialize(connection)
      @connection = connection
    end

    def with_connection
      yield @connection
    end
  end

  setup do
    clear_sync_tables("sync_events")
    ensure_wireless_heatmap_materialized_view
  end

  test "refresh skips when postgres advisory lock is already held" do
    connection = MissingConcurrentIndexConnection.new
    def connection.select_value(statement)
      statements << statement
      false
    end

    WirelessHeatmap.stub(:connection_pool, FakeConnectionPool.new(connection)) do
      assert_equal false, WirelessHeatmap.refresh!
    end
  end

  test "refresh falls back when concurrent index is missing" do
    fake_connection = MissingConcurrentIndexConnection.new

    WirelessHeatmap.stub(:connection_pool, FakeConnectionPool.new(fake_connection)) do
      assert_equal true, WirelessHeatmap.refresh!
    end

    assert_equal [
      "SELECT pg_try_advisory_lock(#{WirelessHeatmap::REFRESH_LOCK_KEY})",
      "REFRESH MATERIALIZED VIEW CONCURRENTLY \"mv_wireless_heatmap\"",
      "REFRESH MATERIALIZED VIEW \"mv_wireless_heatmap\"",
      "SELECT pg_advisory_unlock(#{WirelessHeatmap::REFRESH_LOCK_KEY})"
    ], fake_connection.statements
  end
end
