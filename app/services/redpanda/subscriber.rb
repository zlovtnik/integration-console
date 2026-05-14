require "json"
require "rdkafka"

module Redpanda
  class Subscriber
    INTEGRATION_CACHE_TTL = 30.seconds

    def self.configured_topics
      IntegrationConfig.enabled
        .where(source_type: "redpanda")
        .order(:slug)
        .filter_map { |config| config.params.to_h["topic"].to_s.strip.presence }
        .uniq
    end

    def initialize(bootstrap_servers: ENV.fetch("SYNC_REDPANDA_BOOTSTRAP_SERVERS", "127.0.0.1:9092"), client: nil, topics: nil, run_wireless_worker: true)
      @bootstrap_servers = bootstrap_servers
      @client = client
      @topics = topics
      @integration_by_topic = nil
      @integration_by_topic_expires_at = nil
      @run_wireless_worker = run_wireless_worker
      @wireless_worker = nil
    end

    def run_forever
      owns_client = @client.nil?
      @client ||= build_consumer
      topics.each { |topic| @client.subscribe(topic) }
      start_wireless_worker if @run_wireless_worker
      loop do
        message = @client.poll(1000)
        handle(message.topic, message.payload) if message
      end
    ensure
      @wireless_worker&.stop
      @client&.close if owns_client
      @client = nil if owns_client
    end

    def subscribe_configured
      raise ArgumentError, "Redpanda client is required" unless @client

      topics.each { |topic| @client.subscribe(topic) }
    end

    def reset_integration_cache!
      @integration_by_topic = nil
      @integration_by_topic_expires_at = nil
    end

    def handle(topic, message)
      payload = decode(message)
      sensor_id = payload["sensor_id"]
      RedpandaTrafficSample.increment!(topic: topic, sensor_id: sensor_id)

      if topic == "wireless.audit"
        update_sensor(payload)
        ActionCable.server.broadcast("live_audit", payload)
      elsif topic == "wifi.alert.handshake"
        record_handshake_alert(payload)
      elsif topic == "audit.threat.shadow_device"
        ActionCable.server.broadcast("sensor_alerts", { alert_type: "shadow_device", payload: payload })
      else
        broadcast_unhandled_topic(topic, payload, sensor_id)
      end
    end

    private

    def build_consumer
      Rdkafka::Config.new(
        "bootstrap.servers" => @bootstrap_servers,
        "group.id" => ENV.fetch("INTEGRATION_CONSOLE_REDPANDA_GROUP_ID", "integration-console"),
        "enable.auto.commit" => true,
        "auto.offset.reset" => "latest"
      ).consumer
    end

    def topics
      (@topics || self.class.configured_topics).filter_map { |topic| topic.to_s.strip.presence }.uniq
    end

    def decode(message)
      JSON.parse(message.respond_to?(:payload) ? message.payload : message.to_s)
    rescue JSON::ParserError
      { "raw" => message.to_s }
    end

    def broadcast_unhandled_topic(topic, payload, sensor_id)
      integration = integration_for_topic(topic)
      unless integration
        Rails.logger.info("Unhandled Redpanda topic #{topic} for sensor #{sensor_id.presence || "unknown"}")
        return
      end

      Rails.logger.info("Forwarding unhandled Redpanda topic #{topic} for integration #{integration.slug}")
      ActionCable.server.broadcast("integration:#{integration.slug}", { topic: topic, payload: payload })
    end

    def integration_for_topic(topic)
      integration_by_topic[topic]
    end

    def integration_by_topic
      now = Time.current
      if @integration_by_topic && @integration_by_topic_expires_at && @integration_by_topic_expires_at > now
        return @integration_by_topic
      end

      @integration_by_topic = IntegrationConfig.enabled.where(source_type: "redpanda").each_with_object({}) do |config, memo|
        topic = config.params.to_h["topic"].to_s.strip
        memo[topic] = config if topic.present?
      end
      @integration_by_topic_expires_at = now + INTEGRATION_CACHE_TTL
      @integration_by_topic
    end

    def update_sensor(payload)
      sensor_id = payload["sensor_id"].presence
      return unless sensor_id

      sensor = Sensor.find_or_create_by!(sensor_id: sensor_id) do |record|
        record.location_id = payload["location_id"].presence || "unknown"
      end
      sensor.with_lock do
        sensor.location_id ||= payload["location_id"].presence || "unknown"
        sensor.mark_seen!(payload)
      end
      ActionCable.server.broadcast(
        "sensor_health",
        {
          sensor_id: sensor.sensor_id,
          location_id: sensor.location_id,
          last_seen_at: sensor.last_seen_at,
          status: sensor.status
        }
      )
    end

    def record_handshake_alert(payload)
      sensor_id = payload["sensor_id"].presence || "unknown"
      bssid = payload["bssid"].presence || "unknown"
      client_mac = payload["client_mac"].presence || "unknown"
      alert = SensorAlert.open.find_or_initialize_by(
        sensor_id: sensor_id,
        alert_type: "handshake_captured"
      )
      alert.severity = "critical"
      alert.message = "4-way handshake captured for BSSID #{bssid} client #{client_mac}"
      alert.payload = SensorAlert.sanitize_payload(payload)
      alert.save!
      ActionCable.server.broadcast("sensor_alerts", alert.as_json)
    end

    def start_wireless_worker
      return if @wireless_worker
      return unless @client

      @wireless_worker = WirelessWorker.new(client: @client)
      Thread.new { @wireless_worker.run_forever }
      Rails.logger.info("[Subscriber] Wireless worker thread started")
    end
  end
end
