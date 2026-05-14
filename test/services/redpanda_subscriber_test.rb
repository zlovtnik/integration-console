require "test_helper"

class RedpandaSubscriberTest < ActiveSupport::TestCase
  setup do
    IntegrationRun.delete_all
    IntegrationConfig.delete_all
  end

  FakeClient = Struct.new(:subscriptions) do
    def initialize
      super([])
    end

    def subscribe(topic)
      subscriptions << topic
    end
  end

  test "configured topics come from enabled redpanda integration params" do
    IntegrationConfig.create!(name: "Sync Request", source_type: "redpanda", destination_type: "postgres", params: { topic: "sync.scan.request" })
    IntegrationConfig.create!(name: "Wireless Audit", source_type: "redpanda", destination_type: "postgres", params: { topic: "wireless.audit" })
    IntegrationConfig.create!(name: "Disabled Trace", source_type: "redpanda", destination_type: "postgres", enabled: false, params: { topic: "wifi.alert.handshake" })
    IntegrationConfig.create!(name: "HTTP Sink", source_type: "http", destination_type: "postgres", params: { method: "POST" })

    assert_equal ["sync.scan.request", "wireless.audit"], Redpanda::Subscriber.configured_topics.sort
  end

  test "subscribes once per configured topic" do
    IntegrationConfig.create!(name: "Proxy Scan", source_type: "redpanda", destination_type: "postgres", params: { topic: "sync.scan.request" })
    IntegrationConfig.create!(name: "Atheros Scan", source_type: "redpanda", destination_type: "postgres", params: { topic: "sync.scan.request" })
    IntegrationConfig.create!(name: "Wireless Audit", source_type: "redpanda", destination_type: "postgres", params: { topic: "wireless.audit" })
    client = FakeClient.new

    Redpanda::Subscriber.new(client: client).subscribe_configured

    assert_equal ["sync.scan.request", "wireless.audit"], client.subscriptions.sort
  end

  test "wireless audit updates sensor and throughput sample" do
    payload = {
      sensor_id: "00:11:22:33:44:55",
      location_id: "lab",
      interface: "wlan0",
      channel: 11,
      signal_dbm: -42,
      observed_at: Time.current.iso8601
    }.to_json

    assert_difference -> { Sensor.count }, 1 do
      Redpanda::Subscriber.new.handle("wireless.audit", payload)
    end

    assert_equal 1, RedpandaTrafficSample.sum(:event_count)
    assert_equal "online", Sensor.find_by!(sensor_id: "00:11:22:33:44:55").status
  end

  test "wireless audit preserves existing sensor location when payload omits it" do
    Sensor.create!(sensor_id: "sensor-1", location_id: "lab")

    payload = {
      sensor_id: "sensor-1",
      interface: "wlan0",
      observed_at: Time.current.iso8601
    }.to_json

    Redpanda::Subscriber.new.handle("wireless.audit", payload)

    assert_equal "lab", Sensor.find_by!(sensor_id: "sensor-1").location_id
  end

  test "handshake alert creates sensor alert" do
    payload = {
      sensor_id: "sensor-1",
      location_id: "lab",
      interface: "wlan0",
      bssid: "10:20:30:40:50:60",
      client_mac: "aa:bb:cc:dd:ee:01",
      signal_dbm: -42,
      observed_at: Time.current.iso8601,
      tags: ["threat:harvest", 123, "keep"],
      raw_frame: "large-sensitive-frame",
      ignored_key: "ignored"
    }.to_json

    assert_difference -> { SensorAlert.count }, 1 do
      Redpanda::Subscriber.new.handle("wifi.alert.handshake", payload)
    end

    alert = SensorAlert.last
    assert_equal "sensor-1", alert.sensor_id
    assert_equal "handshake_captured", alert.alert_type
    assert_equal "critical", alert.severity
    assert_includes alert.message, "10:20:30:40:50:60"
    assert_equal "10:20:30:40:50:60", alert.payload.fetch("bssid")
    assert_equal ["threat:harvest", "keep"], alert.payload.fetch("tags")
    assert_not alert.payload.key?("raw_frame")
    assert_not alert.payload.key?("ignored_key")
  end

  test "bandwidth event increments redpanda sample without creating sensor" do
    payload = {
      sensor_id: "sensor-1",
      source_mac: "aa:bb:cc:dd:ee:01",
      destination_bssid: "10:20:30:40:50:60",
      bytes: 1024
    }.to_json

    assert_no_difference -> { Sensor.count } do
      Redpanda::Subscriber.new.handle("audit.wireless.bandwidth", payload)
    end

    sample = RedpandaTrafficSample.find_by!(topic: "audit.wireless.bandwidth", sensor_id: "sensor-1")
    assert_equal 1, sample.event_count
  end
end
