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

  FakePollClient = Struct.new(:responses) do
    def poll(_timeout_ms)
      response = responses.shift
      raise response if response.is_a?(Exception)

      response
    end
  end

  FakeMetadata = Struct.new(:topics)

  FakeLagConsumer = Struct.new(:lag_by_topic) do
    def committed(list, _timeout_ms)
      committed = Rdkafka::Consumer::TopicPartitionList.new
      list.to_h.each do |topic, partitions|
        committed.add_topic_and_partitions_with_offsets(
          topic,
          partitions.each_with_object({}) { |partition, memo| memo[partition.partition] = 0 }
        )
      end
      committed
    end

    def lag(_committed, _timeout_ms)
      lag_by_topic
    end

    def close
      true
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

  test "polling tolerates topics that are still being provisioned" do
    client = FakePollClient.new([Rdkafka::RdkafkaError.new(3), nil])
    subscriber = Redpanda::Subscriber.new(client: client, topic_provisioning_backoff: 0)

    assert_nil subscriber.send(:poll_next_message)
  end

  test "polling raises non provisioning redpanda errors" do
    client = FakePollClient.new([Rdkafka::RdkafkaError.new(17)])
    subscriber = Redpanda::Subscriber.new(client: client, topic_provisioning_backoff: 0)

    error = assert_raises(Rdkafka::RdkafkaError) do
      subscriber.send(:poll_next_message)
    end
    assert_equal :topic_exception, error.code
  end

  test "wireless worker uses its own redpanda consumer" do
    created_options = nil
    worker = Object.new
    worker.define_singleton_method(:run_forever) {}

    worker_factory = lambda do |**options|
      created_options = options
      worker
    end

    Redpanda::WirelessWorker.stub(:new, worker_factory) do
      subscriber = Redpanda::Subscriber.new(bootstrap_servers: "redpanda:9092", client: FakeClient.new)
      subscriber.send(:start_wireless_worker)
      subscriber.instance_variable_get(:@wireless_worker_thread).join(1)
    end

    assert_equal({ bootstrap_servers: "redpanda:9092" }, created_options)
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

  test "redpanda health check reports topic and consumer lag ok" do
    health = Redpanda::HealthCheck.new(
      expected_topics: ["sync.scan.request"],
      consumer_groups: [{ name: "zig-coordinator-scan", topics: ["sync.scan.request"] }],
      broker_probe: ->(_servers) { true },
      metadata_fetcher: -> { FakeMetadata.new([{ topic_name: "sync.scan.request", partitions: [{ partition_id: 0 }] }]) },
      consumer_factory: ->(_group) { FakeLagConsumer.new({ "sync.scan.request" => { 0 => 3 } }) },
      max_lag_messages: 10
    )

    payload = health.call

    assert_equal "ok", payload.fetch(:status)
    assert_equal "present", payload.fetch(:topics).first.fetch(:status)
    assert_equal 3, payload.fetch(:consumerGroups).first.fetch(:lag)
  end

  test "redpanda health check degrades when lag exceeds threshold" do
    health = Redpanda::HealthCheck.new(
      expected_topics: ["sync.scan.request"],
      consumer_groups: [{ name: "zig-coordinator-scan", topics: ["sync.scan.request"] }],
      broker_probe: ->(_servers) { true },
      metadata_fetcher: -> { FakeMetadata.new([{ topic_name: "sync.scan.request", partitions: [{ partition_id: 0 }] }]) },
      consumer_factory: ->(_group) { FakeLagConsumer.new({ "sync.scan.request" => { 0 => 11 } }) },
      max_lag_messages: 10
    )

    payload = health.call

    assert_equal "degraded", payload.fetch(:status)
    assert_equal "degraded", payload.fetch(:consumerGroups).first.fetch(:status)
  end
end
