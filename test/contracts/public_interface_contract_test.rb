require_relative "../contract_test_helper"

class PublicInterfaceContractTest < Minitest::Test
  RESOURCE_ROUTES = %w[
    audit_logs
    backlog
    audit_windows
    integrations
    integration_runs
    wireless_authorized_networks
    devices
    identities
    heatmap
    alerts
    wireless_shadow_alerts
    wireless_clients
    fingerprint_sources
  ].freeze

  CHANNEL_STREAMS = {
    "live_audit_channel.rb" => 'stream_from "live_audit"',
    "sensor_health_channel.rb" => 'stream_from "sensor_health"',
    "alert_channel.rb" => 'stream_from "sensor_alerts"',
    "integration_run_channel.rb" => 'stream_from "integration_run:#{run.id}"'
  }.freeze

  def test_public_resource_and_action_cable_routes_remain_available
    routes = File.read(File.join(CONSOLE_ROOT, "config/routes.rb"))

    assert_includes routes, 'root "dashboard#index"'
    RESOURCE_ROUTES.each { |resource| assert_match(/resources :#{resource}\b/, routes) }
    %w[/metrics /health /health/cards /health/sync_data /health/sensors /health/redpanda].each do |path|
      assert_includes routes, %(get "#{path}")
    end
    assert_includes routes, 'mount ActionCable.server => "/cable"'
  end

  def test_public_action_cable_stream_names_remain_unchanged
    CHANNEL_STREAMS.each do |file, stream_declaration|
      source = File.read(File.join(CONSOLE_ROOT, "app/channels", file))
      assert_includes source, stream_declaration
    end
  end

  def test_device_and_network_json_response_envelopes_remain_compatible
    device_controller = File.read(File.join(CONSOLE_ROOT, "app/controllers/devices_controller.rb"))
    network_controller = File.read(File.join(CONSOLE_ROOT, "app/controllers/authorized_wireless_networks_controller.rb"))

    assert_includes device_controller, "json: { device: device_payload(@device), redirectUrl: devices_path }"
    assert_includes network_controller, "json: { network: authorized_wireless_network_payload(@authorized_wireless_network), redirectUrl: wireless_authorized_networks_path }"
  end
end
