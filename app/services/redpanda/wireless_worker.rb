require "json"
require "rdkafka"

module Redpanda
  class WirelessWorker
    # Mapping of consumer names to their stream and topic
    CONSUMER_CONFIG = {
      "wireless-backlog-list" => {
        stream_env: "WIRELESS_BACKLOG_STREAM",
        stream_default: "WIRELESS_BACKLOG_STREAM",
        topic: "wireless.backlog.list",
        replies_to: "wireless.backlog.list.reply",
      },
      "wireless-backlog-save" => {
        stream_env: "WIRELESS_BACKLOG_STREAM",
        stream_default: "WIRELESS_BACKLOG_STREAM",
        topic: "wireless.backlog.save",
      },
      "wireless-backlog-synced" => {
        stream_env: "WIRELESS_BACKLOG_STREAM",
        stream_default: "WIRELESS_BACKLOG_STREAM",
        topic: "wireless.backlog.synced",
      },
      "wireless-backlog-prune" => {
        stream_env: "WIRELESS_BACKLOG_STREAM",
        stream_default: "WIRELESS_BACKLOG_STREAM",
        topic: "wireless.backlog.prune",
        replies_to: "wireless.backlog.prune.reply",
      },
      "wireless-mac-lookup" => {
        stream_env: "WIRELESS_MAC_STREAM",
        stream_default: "WIRELESS_MAC_STREAM",
        topic: "wireless.mac.lookup",
        replies_to: "wireless.mac.lookup.reply",
      },
      "wireless-networks-authorized" => {
        stream_env: "WIRELESS_NETWORKS_STREAM",
        stream_default: "WIRELESS_NETWORKS_STREAM",
        topic: "wireless.networks.authorized",
        replies_to: "wireless.networks.authorized.reply",
      },
      "wireless-probe-flush" => {
        stream_env: "WIRELESS_PROBE_STREAM",
        stream_default: "WIRELESS_PROBE_STREAM",
        topic: "wireless.probe.flush",
      },
    }.freeze

    FETCH_TIMEOUT = 0.5
    POLL_INTERVAL = 0.5
    HEALTH_FILE = "/tmp/wireless-worker-health"

    def self.healthy?
      File.exist?(HEALTH_FILE) && (Time.now - File.mtime(HEALTH_FILE)) < 60
    end

    def touch_health
      File.write(HEALTH_FILE, Time.now.iso8601)
    rescue => e
      nil
    end

    Message = Struct.new(:topic, :data, keyword_init: true) do
      def ack; end
      def nak; end
    end

    def initialize(bootstrap_servers: ENV.fetch("SYNC_REDPANDA_BOOTSTRAP_SERVERS", "127.0.0.1:9092"),
                   client: nil,
                   poll_interval: POLL_INTERVAL)
      @bootstrap_servers = bootstrap_servers
      @client = client
      @poll_interval = poll_interval
      @running = false
    end

    def run_forever
      @running = true
      owns_client = @client.nil?
      @client ||= build_consumer
      CONSUMER_CONFIG.each_value { |config| @client.subscribe(config[:topic]) }

      Rails.logger.info("[WirelessWorker] Starting wireless worker loop with #{CONSUMER_CONFIG.size} consumers")

      while @running
        begin
          process_next_message
        rescue => e
          Rails.logger.error("[WirelessWorker] Error in worker loop: #{e.class} #{e.message}")
          Rails.logger.error("[WirelessWorker] #{e.backtrace.first(5).join("\n")}")
        end

        touch_health
        sleep @poll_interval if @running
      end
    ensure
      @client&.close if owns_client && @client.respond_to?(:close)
      @client = nil if owns_client
      Rails.logger.info("[WirelessWorker] Wireless worker loop stopped")
    end

    def stop
      @running = false
    end

    private

    def build_consumer
      Rdkafka::Config.new(
        "bootstrap.servers" => @bootstrap_servers,
        "group.id" => ENV.fetch("WIRELESS_WORKER_REDPANDA_GROUP_ID", "integration-console-wireless-worker"),
        "enable.auto.commit" => true,
        "auto.offset.reset" => "earliest"
      ).consumer
    end

    def process_next_message
      message = @client.poll((FETCH_TIMEOUT * 1000).to_i)
      return unless message

      consumer_name, config = CONSUMER_CONFIG.find { |_name, entry| entry[:topic] == message.topic }
      return unless consumer_name

      msg = Message.new(topic: message.topic, data: message.payload)
      payload = decode(msg.data)
      handle_message(consumer_name, msg, payload, config)
    rescue Rdkafka::RdkafkaError
      # No messages available, which is normal
    rescue => e
      Rails.logger.error("[WirelessWorker] Error processing Redpanda message: #{e.class} #{e.message}")
    end

    def handle_message(consumer_name, msg, payload, config)
      case consumer_name
      when "wireless-backlog-list"
        handle_backlog_list(msg, payload, config)
      when "wireless-backlog-save"
        handle_backlog_save(msg, payload, config)
      when "wireless-backlog-synced"
        handle_backlog_synced(msg, payload, config)
      when "wireless-backlog-prune"
        handle_backlog_prune(msg, payload, config)
      when "wireless-mac-lookup"
        handle_mac_lookup(msg, payload, config)
      when "wireless-networks-authorized"
        handle_networks_authorized(msg, payload, config)
      when "wireless-probe-flush"
        handle_probe_flush(msg, payload, config)
      else
        Rails.logger.warn("[WirelessWorker] Unknown consumer: #{consumer_name}")
        msg.ack
      end
    rescue => e
      Rails.logger.error("[WirelessWorker] Handler error for #{consumer_name}: #{e.class} #{e.message}")
      msg.nak rescue nil
    end

    def decode(data)
      JSON.parse(data.to_s)
    rescue JSON::ParserError
      { "raw" => data.to_s }
    end

    def reply(msg, payload, config)
      # The Rust sensor embeds its reply inbox in the JSON payload rather than
      # using the Redpanda protocol-level reply field. Re-parse the original message
      # data to find it, since handlers may build a brand-new response hash.
      original = decode(msg.data) rescue {}
      embedded_reply = original.is_a?(Hash) ? original["reply_topic"] : nil
      reply_topic = embedded_reply || config[:replies_to]
      return unless reply_topic

      body = payload.is_a?(String) ? payload : JSON.generate(payload)
      Redpanda::Publisher.new(bootstrap_servers: @bootstrap_servers).publish(reply_topic, body)
    rescue => e
      Rails.logger.error("[WirelessWorker] Reply error: #{e.class} #{e.message}")
    end

    # ── Consumer Handlers ──────────────────────────────────────────────────

    def handle_backlog_list(msg, _payload, config)
      entries = BacklogStatus.pending.or(BacklogStatus.failed).order(updated_at: :asc)
      result = entries.map do |entry|
        {
          dedupe_key: entry.dedupe_key,
          stream_name: entry.stream_name,
          payload: begin; JSON.parse(entry.payload); rescue; entry.payload; end,
          status: entry.status,
          attempt_count: entry.attempt_count,
          created_at: entry.created_at&.iso8601,
          updated_at: entry.updated_at&.iso8601,
        }
      end

      reply(msg, result, config)
      msg.ack
    end

    def handle_backlog_save(msg, payload, _config)
      dedupe_key = payload["dedupe_key"] || SecureRandom.uuid
      stream_name = payload["stream_name"]
      payload_data = payload["payload"]

      BacklogStatus.create_with(
        stream_name: stream_name,
        payload: payload_data.to_json,
        status: "pending",
        attempt_count: 0
      ).find_or_create_by!(dedupe_key: dedupe_key)

      msg.ack
    end

    def handle_backlog_synced(msg, payload, _config)
      dedupe_key = payload["dedupe_key"]
      if dedupe_key
        BacklogStatus.where(dedupe_key: dedupe_key)
          .update_all(status: "synced", updated_at: Time.current)
      end
      msg.ack
    end

    def handle_backlog_prune(msg, payload, config)
      max_age_hours = payload.fetch("max_age_hours", 72)
      cutoff = Time.current - max_age_hours.hours

      pruned = BacklogStatus.where(status: "synced")
        .where("updated_at < ?", cutoff)
        .delete_all

      reply(msg, { "pruned" => pruned }, config)
      msg.ack
    end

    def handle_mac_lookup(msg, payload, config)
      mac = (payload["mac"] || payload["mac_address"]).to_s.strip.downcase
      if mac.blank?
        reply(msg, { "error" => "mac required" }, config)
        msg.ack
        return
      end

      device = Device.find_by(mac_id: mac) || Device.find_by(mac_hint: mac)

      if device
        reply(msg, {
          "device_id" => device.device_id,
          "username" => device.username,
          "display_name" => device.display_name,
          "hostname" => device.hostname,
          "os_hint" => device.os_hint,
        }, config)
      else
        reply(msg, { "device_id" => nil, "username" => nil }, config)
      end

      msg.ack
    end

    def handle_networks_authorized(msg, _payload, config)
      networks = AuthorizedWirelessNetwork.enabled.ordered.map do |net|
        {
          id: net.id,
          ssid: net.ssid,
          bssid: net.bssid,
          location_id: net.location_id,
          enabled: net.enabled,
        }
      end

      reply(msg, { "networks" => networks }, config)
      msg.ack
    end

    def handle_probe_flush(msg, payload, _config)
      observations = payload["observations"]
      observations = [observations] unless observations.is_a?(Array)

      count = 0
      observations.each do |obs|
        next if obs["mac_address"].blank?
        WirelessProbeObservation.upsert_observation(obs)
        count += 1
      end

      Rails.logger.info("[WirelessWorker] Upserted #{count} probe observations")
      msg.ack
    end
  end
end
