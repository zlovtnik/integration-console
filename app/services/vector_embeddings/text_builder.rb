require "json"

module VectorEmbeddings
  class TextBuilder
    Input = Struct.new(:text, :metadata, keyword_init: true)

    # Full event fields for metadata/display — includes identity anchors.
    EVENT_FIELDS = %w[
      observed_at sensor_id location_id stream_name source_mac bssid destination_bssid ssid
      frame_type frame_subtype channel_number signal_dbm retry more_data power_save protected
      security_flags app_protocol transport_protocol src_ip dst_ip src_port dst_port dns_query_name
      mdns_name dhcp_hostname wps_device_name wps_manufacturer wps_model_name device_fingerprint
      handshake_captured
    ].freeze

    # Semantic-only subset — excludes MACs, IPs, sensor/location identity.
    # Embedding text built from these fields produces vectors that capture
    # behavioural pattern rather than device identity.
    EVENT_SEMANTIC_FIELDS = %w[
      frame_type frame_subtype app_protocol transport_protocol
      security_flags dns_query_name mdns_name dhcp_hostname
      wps_device_name wps_manufacturer wps_model_name device_fingerprint
      handshake_captured protected channel_number signal_dbm
      retry more_data power_save
    ].freeze

    DEVICE_FIELDS = %w[
      mac_id display_name username hostname os_hint mac_hint wg_pubkey first_seen last_seen
    ].freeze

    SNAPSHOT_FIELDS = %w[
      source_mac location_id sensor_id window_start window_end event_count protocol_mix
      frame_type_distribution signal_min_dbm signal_max_dbm signal_avg_dbm retry_count
      protected_count unprotected_count unique_bssid_count mac_rotation_indicators
    ].freeze

    def initialize(connection: SyncRecord.connection)
      @connection = connection
    end

    def build(job)
      case job.fetch("embedding_kind")
      when "event"
        build_event(job)
      when "device"
        build_device(job)
      when "behaviour_window"
        build_behaviour_window(job)
      else
        raise ArgumentError, "unsupported embedding kind: #{job.fetch("embedding_kind")}"
      end
    end

    private

    attr_reader :connection

    def build_event(job)
      row = select_one(<<~SQL, job.fetch("source_key"))
        SELECT
          dedupe_key,
          observed_at,
          stream_name,
          COALESCE(sensor_id, payload->>'sensor_id') AS sensor_id,
          COALESCE(location_id, payload->>'location_id') AS location_id,
          LOWER(COALESCE(source_mac, payload->>'source_mac')) AS source_mac,
          COALESCE(bssid, payload->>'bssid') AS bssid,
          COALESCE(destination_bssid, payload->>'destination_bssid', payload->>'bssid') AS destination_bssid,
          COALESCE(ssid, payload->>'ssid') AS ssid,
          COALESCE(frame_type, payload->>'frame_type') AS frame_type,
          payload->>'frame_subtype' AS frame_subtype,
          COALESCE(channel_number::text, payload->>'channel_number', payload->>'channel') AS channel_number,
          COALESCE(signal_dbm::text, payload->>'signal_dbm') AS signal_dbm,
          COALESCE(retry::text, payload->>'retry') AS retry,
          COALESCE(more_data::text, payload->>'more_data') AS more_data,
          COALESCE(power_save::text, payload->>'power_save') AS power_save,
          COALESCE(protected::text, payload->>'protected') AS protected,
          COALESCE(security_flags::text, payload->>'security_flags') AS security_flags,
          COALESCE(app_protocol, payload->>'app_protocol') AS app_protocol,
          COALESCE(transport_protocol, payload->>'transport_protocol') AS transport_protocol,
          COALESCE(src_ip, payload->>'src_ip') AS src_ip,
          COALESCE(dst_ip, payload->>'dst_ip') AS dst_ip,
          COALESCE(src_port::text, payload->>'src_port') AS src_port,
          COALESCE(dst_port::text, payload->>'dst_port') AS dst_port,
          COALESCE(dns_query_name, payload->>'dns_query_name') AS dns_query_name,
          COALESCE(mdns_name, payload->>'mdns_name') AS mdns_name,
          COALESCE(dhcp_hostname, payload->>'dhcp_hostname') AS dhcp_hostname,
          COALESCE(wps_device_name, payload->>'wps_device_name') AS wps_device_name,
          COALESCE(wps_manufacturer, payload->>'wps_manufacturer') AS wps_manufacturer,
          COALESCE(wps_model_name, payload->>'wps_model_name') AS wps_model_name,
          COALESCE(device_fingerprint, payload->>'device_fingerprint') AS device_fingerprint,
          COALESCE(handshake_captured::text, payload->>'handshake_captured') AS handshake_captured,
          payload->'tags' AS tags
        FROM sync_scan_ingest
        WHERE dedupe_key = $1
      SQL

      # Build embedding text from semantic fields only (identity-stripped)
      semantic_lines = ["kind: event"]
      EVENT_SEMANTIC_FIELDS.each { |field| append_line(semantic_lines, field, row[field]) }
      append_line(semantic_lines, "ssid", row["ssid"])
      embedding_text = semantic_lines.join("\n")

      Input.new(
        text: embedding_text,
        metadata: {
          source_observed_at: row["observed_at"],
          source_stream_name: row["stream_name"],
          source_sensor_id: row["sensor_id"],
          source_location_id: row["location_id"],
          source_mac: row["source_mac"]
        }
      )
    end

    def build_device(job)
      row = select_one(<<~SQL, job.fetch("source_key"))
        SELECT mac_id, display_name, username, hostname, os_hint, mac_hint, wg_pubkey, first_seen, last_seen
        FROM devices
        WHERE mac_id = $1
      SQL

      lines = ["kind: device"]
      DEVICE_FIELDS.each { |field| append_line(lines, field, row[field]) }
      Input.new(
        text: lines.join("\n"),
        metadata: {
          source_observed_at: row["last_seen"],
          source_mac: row["mac_id"]
        }
      )
    end

    def build_behaviour_window(job)
      row = select_one(<<~SQL, job.fetch("source_key"))
        SELECT *
        FROM vec_behaviour_snapshots
        WHERE snapshot_id::text = $1
      SQL

      # Prefer identity-stripped embedding_text for embedding; fall back to
      # text_summary (which includes MAC/sensor/location) for backward compat.
      embedding_text = row["embedding_text"].presence || row["text_summary"].presence
      if embedding_text
        Input.new(
          text: embedding_text,
          metadata: {
            source_observed_at: row["window_start"],
            source_sensor_id: row["sensor_id"],
            source_location_id: row["location_id"],
            source_mac: row["source_mac"]
          }
        )
      else
        lines = ["kind: behaviour_window"]
        SNAPSHOT_FIELDS.each { |field| append_line(lines, field, normalize_json(row[field])) }
        Input.new(
          text: lines.join("\n"),
          metadata: {
            source_observed_at: row["window_start"],
            source_sensor_id: row["sensor_id"],
            source_location_id: row["location_id"],
            source_mac: row["source_mac"]
          }
        )
      end
    end

    def select_one(sql, key)
      rows = connection.exec_query(sql.gsub("$1", connection.quote(key)), "VectorEmbeddings::TextBuilder").to_a
      rows.first || raise(ActiveRecord::RecordNotFound, "embedding source not found: #{key}")
    end

    def append_line(lines, field, value)
      normalized = normalize_json(value)
      return if normalized.nil? || normalized == ""

      lines << "#{field}: #{normalized}"
    end

    def normalize_json(value)
      case value
      when Hash
        JSON.generate(value.sort.to_h)
      when Array
        JSON.generate(value.map(&:to_s).sort)
      else
        value
      end
    end
  end
end
