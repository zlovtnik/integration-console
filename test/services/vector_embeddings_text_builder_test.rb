require "test_helper"

class VectorEmbeddingsTextBuilderTest < ActiveSupport::TestCase
  FakeResult = Struct.new(:rows) do
    def to_a
      rows
    end
  end

  class FakeConnection
    def initialize(row)
      @row = row
    end

    def exec_query(_sql, _name = nil)
      FakeResult.new([@row])
    end

    def quote(value)
      "'#{value.to_s.gsub("'", "''")}'"
    end
  end

  test "builds deterministic event text from promoted and allowlisted fields" do
    row = {
      "dedupe_key" => "event-1",
      "observed_at" => "2026-05-15 10:00:00 UTC",
      "stream_name" => "wireless.audit",
      "sensor_id" => "sensor-1",
      "location_id" => "lab",
      "source_mac" => "aa:bb:cc:dd:ee:ff",
      "bssid" => "10:20:30:40:50:60",
      "destination_bssid" => "10:20:30:40:50:60",
      "ssid" => "corp",
      "frame_type" => "management",
      "frame_subtype" => "probe",
      "signal_dbm" => "-42",
      "retry" => "false",
      "protected" => "true",
      "app_protocol" => "mdns",
      "tags" => ["threat:signal_anomaly", "audit"]
    }
    builder = VectorEmbeddings::TextBuilder.new(connection: FakeConnection.new(row))
    input = builder.build("embedding_kind" => "event", "source_key" => "event-1")

    assert_includes input.text, "kind: event"
    assert_includes input.text, "source_mac: aa:bb:cc:dd:ee:ff"
    assert_includes input.text, "tags: [\"audit\",\"threat:signal_anomaly\"]"
    assert_equal "sensor-1", input.metadata[:source_sensor_id]
    assert_not_includes input.text, "payload"
  end
end
