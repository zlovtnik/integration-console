require_relative "../contract_test_helper"
require File.join(CONSOLE_ROOT, "app/lib/integration_console/action_cable_broadcast_contract")

class ActionCableBroadcastContractTest < Minitest::Test
  def test_octopus_envelope_matches_redis_adapter_wire_contract
    envelope = IntegrationConsole::ActionCableBroadcastContract.envelope(
      stream: "live_audit",
      message: { "dedupe_key" => "wireless-1", "signal_dbm" => -42 },
      prefix: "integration_console_production"
    )

    assert_equal "integration_console_production:live_audit", envelope.fetch(:redis_channel)
    assert_equal(
      { "dedupe_key" => "wireless-1", "signal_dbm" => -42 },
      IntegrationConsole::ActionCableBroadcastContract.decode(envelope.fetch(:payload))
    )
  end

  def test_preserves_all_public_stream_names
    streams = %w[live_audit sensor_health sensor_alerts]
    streams << "integration_run:09f9a3ba-d8e9-4b3a-bbd3-05173bfe1b4d"

    streams.each do |stream|
      assert_equal stream, IntegrationConsole::ActionCableBroadcastContract.validate_stream!(stream)
    end
  end

  def test_rejects_arbitrary_redis_channels_and_non_object_payloads
    assert_raises(ArgumentError) do
      IntegrationConsole::ActionCableBroadcastContract.redis_channel("admin", prefix: "integration_console_production")
    end
    assert_raises(ArgumentError) do
      IntegrationConsole::ActionCableBroadcastContract.decode("[]")
    end
  end
end
