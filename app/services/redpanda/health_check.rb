# frozen_string_literal: true

require "rdkafka"
require "socket"

module Redpanda
  class HealthCheck
    CORE_TOPICS = %w[
      sync.scan.request
      sync.oracle.load
      sync.oracle.result
    ].freeze

    ORACLE_STREAM_TOPICS = %w[
      proxy.events
      wireless.audit
      audit.wireless.bandwidth
      wireless.alert.rogue_ap
      wireless.alert.deauth_flood
      wireless.alert.signal_anomaly
      wireless.alert.pmf_attack
      wireless.client.inventory
      wireless.probe.flush
    ].freeze

    ZIG_WIRELESS_CONSUMERS = {
      "WIRELESS_BACKLOG_SAVE_CONSUMER" => ["wireless-backlog-save", "wireless.backlog.save"],
      "WIRELESS_BACKLOG_LIST_CONSUMER" => ["wireless-backlog-list", "wireless.backlog.list"],
      "WIRELESS_BACKLOG_SYNCED_CONSUMER" => ["wireless-backlog-synced", "wireless.backlog.synced"],
      "WIRELESS_BACKLOG_PRUNE_CONSUMER" => ["wireless-backlog-prune", "wireless.backlog.prune"],
      "WIRELESS_MAC_LOOKUP_CONSUMER" => ["wireless-mac-lookup", "wireless.mac.lookup"],
      "WIRELESS_NETWORKS_AUTHORIZED_CONSUMER" => ["wireless-networks-authorized", "wireless.networks.authorized"],
      "WIRELESS_PROBE_FLUSH_CONSUMER" => ["wireless-probe-flush", "wireless.probe.flush"]
    }.freeze

    DEFAULT_TIMEOUT_MS = 2_000
    SAMPLE_FRESHNESS = 5.minutes

    def initialize(
      bootstrap_servers: ENV.fetch("SYNC_REDPANDA_BOOTSTRAP_SERVERS", "127.0.0.1:9092"),
      max_lag_messages: ENV.fetch("REDPANDA_MAX_LAG_MESSAGES", "1000").to_i,
      expected_topics: nil,
      consumer_groups: nil,
      broker_probe: nil,
      metadata_fetcher: nil,
      consumer_factory: nil,
      now: -> { Time.current }
    )
      @bootstrap_servers = bootstrap_servers
      @max_lag_messages = max_lag_messages.positive? ? max_lag_messages : 1000
      @expected_topics = expected_topics
      @consumer_groups = consumer_groups
      @broker_probe = broker_probe
      @metadata_fetcher = metadata_fetcher
      @consumer_factory = consumer_factory
      @now = now
    end

    def call
      fetched_at = @now.call
      broker = broker_status
      metadata = broker[:reachable] ? fetch_metadata : nil
      topics = topic_statuses(metadata)
      consumer_groups = consumer_group_statuses(metadata)
      samples = sample_statuses(fetched_at)
      status = broker[:status] == "ok" &&
        topics.all? { |topic| topic[:status] == "present" } &&
        consumer_groups.all? { |group| group[:status] == "ok" } ? "ok" : "degraded"

      {
        status: status,
        broker: broker,
        topics: topics,
        consumerGroups: consumer_groups,
        samples: samples,
        fetchedAt: fetched_at.iso8601
      }
    end

    private

    attr_reader :bootstrap_servers, :max_lag_messages

    def broker_status
      servers = normalized_servers
      if @broker_probe
        @broker_probe.call(servers)
      else
        probe_brokers(servers)
      end
      { status: "ok", reachable: true, bootstrapServers: servers }
    rescue StandardError => error
      {
        status: "error",
        reachable: false,
        bootstrapServers: servers,
        message: error.message
      }
    end

    def fetch_metadata
      return @metadata_fetcher.call if @metadata_fetcher

      Rdkafka::Config.new("bootstrap.servers" => normalized_servers.join(",")).admin.metadata(nil, DEFAULT_TIMEOUT_MS)
    rescue StandardError => error
      Rails.logger.warn("Redpanda metadata health check failed: #{error.class} #{error.message}")
      nil
    end

    def topic_statuses(metadata)
      metadata_by_topic = metadata_topics(metadata)
      expected_topics.map do |topic|
        details = metadata_by_topic[topic]
        if details
          {
            name: topic,
            status: "present",
            partitions: details.fetch(:partitions, []).length
          }
        else
          {
            name: topic,
            status: metadata ? "missing" : "unknown",
            partitions: 0
          }
        end
      end
    end

    def consumer_group_statuses(metadata)
      metadata_by_topic = metadata_topics(metadata)
      return unknown_consumer_groups unless metadata

      expected_consumer_groups.map do |group|
        consumer_group_status(group, metadata_by_topic)
      end
    end

    def unknown_consumer_groups
      expected_consumer_groups.map do |group|
        {
          name: group.fetch(:name),
          status: "unknown",
          lag: nil,
          maxLag: max_lag_messages,
          topics: group.fetch(:topics).map { |topic| { name: topic, status: "unknown", lag: nil } }
        }
      end
    end

    def consumer_group_status(group, metadata_by_topic)
      consumer = build_consumer(group.fetch(:name))
      requested = Rdkafka::Consumer::TopicPartitionList.new
      topic_partitions = group.fetch(:topics).each_with_object({}) do |topic, memo|
        partitions = metadata_by_topic.dig(topic, :partitions) || []
        memo[topic] = partitions.map { |partition| partition.fetch(:partition_id) }
        requested.add_topic(topic, memo[topic]) if memo[topic].any?
      end

      return missing_topic_group(group, topic_partitions) if requested.empty?

      committed = consumer.committed(requested, DEFAULT_TIMEOUT_MS)
      lag_by_topic = consumer.lag(committed, DEFAULT_TIMEOUT_MS)
      topic_rows = group.fetch(:topics).map do |topic|
        topic_lag_rows(topic, topic_partitions.fetch(topic, []), committed, lag_by_topic)
      end
      flattened_lags = topic_rows.flat_map { |row| row[:partitions].filter_map { |partition| partition[:lag] } }
      total_lag = flattened_lags.sum
      status = topic_rows.all? { |row| row[:status] == "ok" } && total_lag <= max_lag_messages ? "ok" : "degraded"

      {
        name: group.fetch(:name),
        status: status,
        lag: total_lag,
        maxLag: max_lag_messages,
        topics: topic_rows
      }
    rescue StandardError => error
      {
        name: group.fetch(:name),
        status: "error",
        lag: nil,
        maxLag: max_lag_messages,
        message: error.message,
        topics: group.fetch(:topics).map { |topic| { name: topic, status: "unknown", lag: nil } }
      }
    ensure
      consumer&.close if consumer&.respond_to?(:close)
    end

    def missing_topic_group(group, topic_partitions)
      {
        name: group.fetch(:name),
        status: "degraded",
        lag: nil,
        maxLag: max_lag_messages,
        topics: group.fetch(:topics).map do |topic|
          { name: topic, status: topic_partitions.fetch(topic, []).any? ? "ok" : "missing", lag: nil }
        end
      }
    end

    def topic_lag_rows(topic, partition_ids, committed, lag_by_topic)
      committed_by_partition = committed.to_h.fetch(topic, []).each_with_object({}) do |partition, memo|
        memo[partition.partition] = partition.offset
      end
      partition_rows = partition_ids.map do |partition_id|
        offset = committed_by_partition[partition_id]
        lag = lag_by_topic.dig(topic, partition_id)
        partition_status =
          if offset.nil?
            "no_offset"
          elsif lag.to_i > max_lag_messages
            "lagging"
          else
            "ok"
          end
        {
          partition: partition_id,
          committedOffset: offset,
          lag: lag,
          status: partition_status
        }
      end

      topic_status = partition_rows.all? { |partition| partition[:status] == "ok" } ? "ok" : "degraded"
      {
        name: topic,
        status: topic_status,
        lag: partition_rows.filter_map { |partition| partition[:lag] }.sum,
        partitions: partition_rows
      }
    end

    def sample_statuses(fetched_at)
      recent_counts = RedpandaTrafficSample.recent.group(:topic).sum(:event_count)
      latest_samples = RedpandaTrafficSample.where(topic: expected_topics).group(:topic).maximum(:sampled_at)

      expected_topics.map do |topic|
        last_sampled_at = latest_samples[topic]
        age_seconds = last_sampled_at ? (fetched_at - last_sampled_at).to_i : nil
        status =
          if last_sampled_at.nil?
            "missing"
          elsif age_seconds <= SAMPLE_FRESHNESS.to_i
            "fresh"
          else
            "stale"
          end
        {
          topic: topic,
          status: status,
          eventCount: recent_counts.fetch(topic, 0),
          lastSampledAt: last_sampled_at&.iso8601,
          ageSeconds: age_seconds
        }
      end
    end

    def metadata_topics(metadata)
      Array(metadata&.topics).each_with_object({}) do |topic, memo|
        name = topic.fetch(:topic_name).to_s
        memo[name] = {
          partitions: Array(topic[:partitions]).map { |partition| partition.transform_keys(&:to_sym) }
        }
      end
    end

    def expected_topics
      @expected_topics ||= (CORE_TOPICS + ORACLE_STREAM_TOPICS + Redpanda::Subscriber.configured_topics).filter_map(&:presence).uniq.sort
    end

    def expected_consumer_groups
      @consumer_groups ||= begin
        configured_topics = Redpanda::Subscriber.configured_topics
        wireless_topics = Redpanda::WirelessWorker::CONSUMER_CONFIG.values.filter_map { |config| config[:topic] }
        groups = [
          { name: ENV.fetch("INTEGRATION_CONSOLE_REDPANDA_GROUP_ID", "integration-console"), topics: configured_topics },
          { name: ENV.fetch("WIRELESS_WORKER_REDPANDA_GROUP_ID", "integration-console-wireless-worker"), topics: wireless_topics },
          { name: ENV.fetch("SYNC_SCAN_CONSUMER", "zig-coordinator-scan"), topics: [ENV.fetch("SYNC_SCAN_TOPIC", "sync.scan.request")] },
          { name: ENV.fetch("SYNC_LOAD_CONSUMER", "oracle-worker-load"), topics: [ENV.fetch("SYNC_LOAD_TOPIC", "sync.oracle.load")] },
          { name: ENV.fetch("SYNC_RESULT_CONSUMER", "zig-coordinator-result"), topics: [ENV.fetch("SYNC_RESULT_TOPIC", "sync.oracle.result")] }
        ]
        ZIG_WIRELESS_CONSUMERS.each do |env_name, (default_group, topic)|
          groups << { name: ENV.fetch(env_name, default_group), topics: [topic] }
        end
        groups.map { |group| { name: group.fetch(:name), topics: group.fetch(:topics).filter_map(&:presence).uniq } }
          .reject { |group| group[:name].blank? || group[:topics].empty? }
      end
    end

    def build_consumer(group_id)
      return @consumer_factory.call(group_id) if @consumer_factory

      Rdkafka::Config.new(
        "bootstrap.servers" => normalized_servers.join(","),
        "group.id" => group_id,
        "enable.auto.commit" => false,
        "auto.offset.reset" => "earliest"
      ).consumer
    end

    def probe_brokers(servers)
      errors = []
      servers.each do |server|
        host, port = parse_server(server)
        Socket.tcp(host, port, connect_timeout: 1) { return true }
      rescue StandardError => error
        errors << "#{server}: #{error.message}"
      end
      raise errors.join("; ")
    end

    def normalized_servers
      bootstrap_servers.to_s.split(",").filter_map do |server|
        server.strip.sub(/\A[a-z][a-z0-9+.-]*:\/\//i, "").presence
      end
    end

    def parse_server(server)
      host, port = server.rpartition(":").values_at(0, 2)
      host = server if host.blank?
      [host, port.presence&.to_i || 9092]
    end
  end
end
