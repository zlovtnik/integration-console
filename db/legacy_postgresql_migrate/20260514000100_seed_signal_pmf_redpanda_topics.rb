class SeedSignalPmfRedpandaTopics < ActiveRecord::Migration[7.2]
  TOPIC_INTEGRATIONS = [
    { name: "Atheros Signal Anomaly Alerts", slug: "atheros-signal-anomaly-alerts", stream_name: "wireless.alert.signal_anomaly", topic: "wireless.alert.signal_anomaly" },
    { name: "Atheros PMF Attack Alerts", slug: "atheros-pmf-attack-alerts", stream_name: "wireless.alert.pmf_attack", topic: "wireless.alert.pmf_attack" }
  ].freeze

  PARAM_SCHEMA = {
    "url" => { "type" => "string", "label" => "Redpanda URL", "placeholder" => "127.0.0.1:9092" },
    "topic" => { "type" => "string", "label" => "Topic", "placeholder" => "wireless.alert.signal_anomaly" },
    "consumer_name" => { "type" => "string", "label" => "Consumer" }
  }.freeze

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
        param_schema: PARAM_SCHEMA,
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
