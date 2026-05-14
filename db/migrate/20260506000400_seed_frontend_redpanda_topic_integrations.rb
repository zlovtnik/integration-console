class SeedFrontendRedpandaTopicIntegrations < ActiveRecord::Migration[7.2]
  Redpanda_PARAM_SCHEMA = {
    "url" => { "type" => "string", "label" => "Redpanda URL", "placeholder" => "redpanda://127.0.0.1:4222" },
    "topic" => { "type" => "string", "label" => "Topic", "placeholder" => "wireless.audit" },
    "consumer_name" => { "type" => "string", "label" => "Consumer" }
  }.freeze

  TOPIC_INTEGRATIONS = [
    { name: "Proxy Events Scan Request", slug: "proxy-events-scan-request", stream_name: "proxy.events", topic: "sync.scan.request" },
    { name: "Proxy Payload Audit", slug: "proxy-payload-audit", stream_name: "proxy.payload_audit", topic: "proxy.payload_audit" },
    { name: "Atheros Wireless Audit", slug: "atheros-wireless-audit", stream_name: "wireless.audit", topic: "wireless.audit" },
    { name: "Atheros Handshake Alerts", slug: "atheros-handshake-alerts", stream_name: "wifi.alert.handshake", topic: "wifi.alert.handshake" },
    { name: "Atheros Wireless Bandwidth", slug: "atheros-wireless-bandwidth", stream_name: "audit.wireless.bandwidth", topic: "audit.wireless.bandwidth" },
    { name: "Atheros Client Inventory", slug: "atheros-client-inventory", stream_name: "wireless.client.inventory", topic: "wireless.client.inventory" },
    { name: "Atheros Rogue AP Alerts", slug: "atheros-rogue-ap-alerts", stream_name: "wireless.alert.rogue_ap", topic: "wireless.alert.rogue_ap" },
    { name: "Atheros Deauth Flood Alerts", slug: "atheros-deauth-flood-alerts", stream_name: "wireless.alert.deauth_flood", topic: "wireless.alert.deauth_flood" },
    { name: "Atheros Attack Sequence Alerts", slug: "atheros-attack-sequence-alerts", stream_name: "wireless.alert.attack_sequence", topic: "wireless.alert.attack_sequence" },
    { name: "Atheros Audit Config", slug: "atheros-audit-config", stream_name: "wireless.audit.config", topic: "wireless.audit.config" },
    { name: "Atheros Authorized Network Config", slug: "atheros-authorized-network-config", stream_name: "wireless.config.authorized_networks", topic: "wireless.config.authorized_networks" },
    { name: "Atheros Sensor Config", slug: "atheros-sensor-config", stream_name: "wireless.config.sensor", topic: "wireless.config.sensor" },
    { name: "Zig Oracle Load", slug: "zig-oracle-load", stream_name: "sync.oracle.load", topic: "sync.oracle.load" },
    { name: "Zig Oracle Result", slug: "zig-oracle-result", stream_name: "sync.oracle.result", topic: "sync.oracle.result" },
    { name: "Zig Shadow Device Alerts", slug: "zig-shadow-device-alerts", stream_name: "audit.threat.shadow_device", topic: "audit.threat.shadow_device" },
    { name: "Zig Wireless Backlog Save", slug: "zig-wireless-backlog-save", stream_name: "wireless.backlog.save", topic: "wireless.backlog.save" },
    { name: "Zig Wireless Backlog List", slug: "zig-wireless-backlog-list", stream_name: "wireless.backlog.list", topic: "wireless.backlog.list" },
    { name: "Zig Wireless Backlog Synced", slug: "zig-wireless-backlog-synced", stream_name: "wireless.backlog.synced", topic: "wireless.backlog.synced" },
    { name: "Zig Wireless Backlog Prune", slug: "zig-wireless-backlog-prune", stream_name: "wireless.backlog.prune", topic: "wireless.backlog.prune" },
    { name: "Zig Wireless Backlog List Reply", slug: "zig-wireless-backlog-list-reply", stream_name: "wireless.backlog.list.reply", topic: "wireless.backlog.list.reply" },
    { name: "Zig Wireless Backlog Prune Reply", slug: "zig-wireless-backlog-prune-reply", stream_name: "wireless.backlog.prune.reply", topic: "wireless.backlog.prune.reply" },
    { name: "Zig Wireless MAC Lookup", slug: "zig-wireless-mac-lookup", stream_name: "wireless.mac.lookup", topic: "wireless.mac.lookup" },
    { name: "Zig Wireless MAC Lookup Reply", slug: "zig-wireless-mac-lookup-reply", stream_name: "wireless.mac.lookup.reply", topic: "wireless.mac.lookup.reply" },
    { name: "Zig Wireless Networks Authorized", slug: "zig-wireless-networks-authorized", stream_name: "wireless.networks.authorized", topic: "wireless.networks.authorized" },
    { name: "Zig Wireless Networks Authorized Reply", slug: "zig-wireless-networks-authorized-reply", stream_name: "wireless.networks.authorized.reply", topic: "wireless.networks.authorized.reply" },
    { name: "Zig Wireless Probe Flush", slug: "zig-wireless-probe-flush", stream_name: "wireless.probe.flush", topic: "wireless.probe.flush" }
  ].freeze

  class SeededIntegrationConfig < ActiveRecord::Base
    self.table_name = "integration_configs"

    attribute :params, :json, default: -> { {} }
    encrypts :params
  end

  def up
    now = Time.current

    TOPIC_INTEGRATIONS.each do |integration|
      record = SeededIntegrationConfig.find_or_initialize_by(slug: integration.fetch(:slug))
      record.assign_attributes(
        name: integration.fetch(:name),
        source_type: "redpanda",
        destination_type: "postgres",
        stream_name: integration.fetch(:stream_name),
        enabled: true,
        schedule_cron: nil,
        params: { "topic" => integration.fetch(:topic) },
        param_schema: Redpanda_PARAM_SCHEMA,
        cursor_field: nil,
        updated_at: now
      )
      record.created_at ||= now
      record.save!
    end
  end

  def down
    SeededIntegrationConfig.where(slug: TOPIC_INTEGRATIONS.map { |integration| integration.fetch(:slug) }).delete_all
  end
end
