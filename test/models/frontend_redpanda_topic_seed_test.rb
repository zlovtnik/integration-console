require "test_helper"
require Rails.root.join("db/migrate/20260506000400_seed_frontend_redpanda_topic_integrations").to_s

class FrontendRedpandaTopicSeedTest < ActiveSupport::TestCase
  setup do
    IntegrationRun.delete_all
    IntegrationConfig.delete_all
  end

  test "seed migration creates valid frontend redpanda topic integrations" do
    SeedFrontendRedpandaTopicIntegrations.new.up

    seeded_rows = IntegrationConfig.where(slug: seeded_slugs).order(:slug).to_a

    assert_equal SeedFrontendRedpandaTopicIntegrations::TOPIC_INTEGRATIONS.length, seeded_rows.length
    seeded_rows.each do |config|
      expected = seed_for(config.slug)

      assert_predicate config, :valid?
      assert_match(/\A[a-z0-9-]+\z/, config.slug)
      assert_predicate config, :enabled?
      assert_equal "redpanda", config.source_type
      assert_equal "postgres", config.destination_type
      assert_equal expected.fetch(:stream_name), config.stream_name
      assert_equal expected.fetch(:topic), config.params.fetch("topic")
    end

    raw_params = IntegrationConfig.connection.select_value(
      "SELECT params FROM integration_configs WHERE slug = #{IntegrationConfig.connection.quote("proxy-payload-audit")}"
    )
    assert_not_nil raw_params
    assert_not_includes raw_params, "proxy.payload_audit"
  end

  test "seed migration is idempotent" do
    2.times { SeedFrontendRedpandaTopicIntegrations.new.up }

    assert_equal SeedFrontendRedpandaTopicIntegrations::TOPIC_INTEGRATIONS.length,
      IntegrationConfig.where(slug: seeded_slugs).count
  end

  private

  def seeded_slugs
    SeedFrontendRedpandaTopicIntegrations::TOPIC_INTEGRATIONS.map { |integration| integration.fetch(:slug) }
  end

  def seed_for(slug)
    SeedFrontendRedpandaTopicIntegrations::TOPIC_INTEGRATIONS.find { |integration| integration.fetch(:slug) == slug }
  end
end
