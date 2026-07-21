require "test_helper"

class WirelessHeatmapTest < ActiveSupport::TestCase
  test "refresh is owned by Octopus" do
    error = assert_raises(ActiveRecord::ReadOnlyRecord) { WirelessHeatmap.refresh! }

    assert_includes error.message, "maintained by Octopus"
  end
end
