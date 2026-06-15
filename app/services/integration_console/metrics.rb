require "monitor"

module IntegrationConsole
  class Metrics
    BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0].freeze

    class << self
      def observe_http(controller:, action:, method:, status:, duration_ms:)
        labels = {
          controller: compact_label(controller),
          action: compact_label(action),
          method: compact_label(method),
          status: status.to_i.to_s,
        }
        observe("integration_console_http_request_duration_seconds", labels, duration_ms.to_f / 1000.0)
        increment("integration_console_http_requests_total", labels)
      end

      def observe_sql(sql:, cached:, duration_ms:)
        labels = {
          operation: sql_operation(sql),
          cached: cached ? "true" : "false",
        }
        observe("integration_console_active_record_query_duration_seconds", labels, duration_ms.to_f / 1000.0)
        increment("integration_console_active_record_queries_total", labels)
      end

      def observe_cache(operation:)
        increment("integration_console_cache_events_total", { operation: compact_label(operation) })
      end

      def observe_worker_cycle(worker:, status:, duration_ms:)
        labels = { worker: compact_label(worker), status: compact_label(status) }
        observe("integration_console_worker_cycle_duration_seconds", labels, duration_ms.to_f / 1000.0)
        increment("integration_console_worker_cycles_total", labels)
        gauge("integration_console_worker_last_run_timestamp_seconds", { worker: compact_label(worker) }, Time.now.to_f)
      end

      def gauge(name, labels, value)
        synchronize do
          state[:gauges][series_key(name, labels)] = [name, normalize_labels(labels), value.to_f]
        end
      end

      def render
        snapshot = synchronize do
          {
            counters: state[:counters].values.map(&:dup),
            histograms: state[:histograms].values.map { |histogram| Marshal.load(Marshal.dump(histogram)) },
            gauges: state[:gauges].values.map(&:dup),
          }
        end

        lines = []
        lines << "# HELP integration_console_up Process health status."
        lines << "# TYPE integration_console_up gauge"
        lines << "integration_console_up 1"

        emit_counter(lines, "integration_console_http_requests_total", "HTTP requests handled by Rails.", snapshot[:counters])
        emit_histogram(lines, "integration_console_http_request_duration_seconds", "HTTP request duration in seconds.", snapshot[:histograms])
        emit_counter(lines, "integration_console_active_record_queries_total", "ActiveRecord SQL queries observed.", snapshot[:counters])
        emit_histogram(lines, "integration_console_active_record_query_duration_seconds", "ActiveRecord SQL query duration in seconds.", snapshot[:histograms])
        emit_counter(lines, "integration_console_cache_events_total", "Rails cache events observed.", snapshot[:counters])
        emit_counter(lines, "integration_console_worker_cycles_total", "Background worker cycles observed.", snapshot[:counters])
        emit_histogram(lines, "integration_console_worker_cycle_duration_seconds", "Background worker cycle duration in seconds.", snapshot[:histograms])
        emit_gauge(lines, "integration_console_worker_last_run_timestamp_seconds", "Last background worker run timestamp.", snapshot[:gauges])

        lines.join("\n") + "\n"
      end

      private

      def increment(name, labels, by = 1)
        synchronize do
          key = series_key(name, labels)
          state[:counters][key] ||= [name, normalize_labels(labels), 0.0]
          state[:counters][key][2] += by
        end
      end

      def observe(name, labels, value)
        synchronize do
          key = series_key(name, labels)
          histogram = state[:histograms][key] ||= {
            name: name,
            labels: normalize_labels(labels),
            buckets: Hash.new(0),
            count: 0,
            sum: 0.0,
          }
          BUCKETS.each do |bucket|
            histogram[:buckets][bucket] += 1 if value <= bucket
          end
          histogram[:buckets][Float::INFINITY] += 1
          histogram[:count] += 1
          histogram[:sum] += value
        end
      end

      def emit_counter(lines, name, help, counters)
        matching = counters.select { |entry| entry[0] == name }
        return if matching.empty?

        lines << "# HELP #{name} #{help}"
        lines << "# TYPE #{name} counter"
        matching.each do |(_metric, labels, value)|
          lines << "#{name}#{label_set(labels)} #{format_number(value)}"
        end
      end

      def emit_histogram(lines, name, help, histograms)
        matching = histograms.select { |entry| entry[:name] == name }
        return if matching.empty?

        lines << "# HELP #{name} #{help}"
        lines << "# TYPE #{name} histogram"
        matching.each do |entry|
          BUCKETS.each do |bucket|
            lines << "#{name}_bucket#{label_set(entry[:labels].merge(le: bucket_label(bucket)))} #{entry[:buckets][bucket]}"
          end
          lines << "#{name}_bucket#{label_set(entry[:labels].merge(le: '+Inf'))} #{entry[:buckets][Float::INFINITY]}"
          lines << "#{name}_sum#{label_set(entry[:labels])} #{format_number(entry[:sum])}"
          lines << "#{name}_count#{label_set(entry[:labels])} #{entry[:count]}"
        end
      end

      def emit_gauge(lines, name, help, gauges)
        matching = gauges.select { |entry| entry[0] == name }
        return if matching.empty?

        lines << "# HELP #{name} #{help}"
        lines << "# TYPE #{name} gauge"
        matching.each do |(_metric, labels, value)|
          lines << "#{name}#{label_set(labels)} #{format_number(value)}"
        end
      end

      def state
        @state ||= { counters: {}, histograms: {}, gauges: {} }
      end

      def synchronize(&block)
        monitor.synchronize(&block)
      end

      def monitor
        @monitor ||= Monitor.new
      end

      def series_key(name, labels)
        [name, normalize_labels(labels).sort].hash
      end

      def normalize_labels(labels)
        labels.transform_keys(&:to_s).transform_values { |value| compact_label(value) }
      end

      def label_set(labels)
        return "" if labels.empty?

        "{" + labels.sort.map { |key, value| "#{key}=\"#{escape_label(value)}\"" }.join(",") + "}"
      end

      def compact_label(value)
        raw = value.to_s
        raw.empty? ? "unknown" : raw.gsub(/[^A-Za-z0-9_.:-]/, "_")[0, 80]
      end

      def escape_label(value)
        value.to_s.gsub("\\", "\\\\\\").gsub("\"", "\\\"").gsub("\n", "\\n")
      end

      def format_number(value)
        value.to_f.finite? ? ("%.6f" % value).sub(/\.?0+$/, "") : "0"
      end

      def bucket_label(bucket)
        format_number(bucket)
      end

      def sql_operation(sql)
        sql.to_s.strip.split(/\s+/, 2).first.to_s.upcase.then { |op| op.empty? ? "UNKNOWN" : compact_label(op) }
      end
    end
  end
end
