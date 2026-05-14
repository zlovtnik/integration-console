require "test_helper"
require "json"

class FingerprintSourcesControllerTest < ActionDispatch::IntegrationTest
  setup do
    clear_sync_tables("sync_scan_ingest")
  end

  test "index includes fingerprints stored only in payload" do
    insert_sync_ingest(
      dedupe_key: "fingerprint-source-1",
      observed_at: 2.minutes.ago,
      payload: {
        "device_fingerprint" => "payload-only-fp",
        "source_mac" => "00:11:22:33:44:55",
        "ssid" => "CorpWiFi",
        "sensor_id" => "sensor-1"
      }
    )
    insert_sync_ingest(
      dedupe_key: "fingerprint-source-2",
      observed_at: Time.current,
      payload: {
        "device_fingerprint" => "payload-only-fp",
        "source_mac" => "00:11:22:33:44:66",
        "ssid" => "CorpWiFi",
        "sensor_id" => "sensor-2"
      }
    )
    sync_connection.execute(<<~SQL.squish)
      UPDATE sync_scan_ingest
      SET device_fingerprint = NULL
      WHERE dedupe_key IN ('fingerprint-source-1', 'fingerprint-source-2')
    SQL

    get fingerprint_sources_url(format: :json)

    assert_response :success
    row = JSON.parse(response.body).fetch("rows").first
    assert_equal "payload-only-fp", row.fetch("device_fingerprint")
    assert_equal 2, row.fetch("source_count")
    assert_equal ["00:11:22:33:44:55", "00:11:22:33:44:66"], row.fetch("source_macs")
  end

  test "index filters aggregated payload fingerprints and source macs" do
    insert_sync_ingest(
      dedupe_key: "fingerprint-match",
      observed_at: Time.current,
      payload: {
        "device_fingerprint" => "match-payload-fp",
        "source_mac" => "aa:bb:cc:dd:ee:ff",
        "ssid" => "CorpWiFi"
      }
    )
    insert_sync_ingest(
      dedupe_key: "fingerprint-miss",
      observed_at: Time.current,
      payload: {
        "device_fingerprint" => "miss-payload-fp",
        "source_mac" => "10:20:30:40:50:60",
        "ssid" => "GuestWiFi"
      }
    )
    sync_connection.execute(<<~SQL.squish)
      UPDATE sync_scan_ingest
      SET device_fingerprint = NULL
      WHERE dedupe_key IN ('fingerprint-match', 'fingerprint-miss')
    SQL

    filters = [
      { field: "device_fingerprint", operator: "contains", value: "match-payload", conjunction: "AND" },
      { field: "source_mac", operator: "contains", value: "aa:bb", conjunction: "AND" }
    ].to_json

    get fingerprint_sources_url(format: :json, filters: filters)

    assert_response :success
    payload = JSON.parse(response.body)
    assert_equal ["match-payload-fp"], payload.fetch("rows").map { |row| row["device_fingerprint"] }
    assert_equal 2, payload.fetch("filters").length
  end
end
