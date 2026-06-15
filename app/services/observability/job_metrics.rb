module Observability
  class JobMetrics
    class << self
      def record(job:, status:, duration_ms:, extra: {})
        IntegrationConsole::Metrics.observe_worker_cycle(
          worker: job,
          status: status,
          duration_ms: duration_ms
        )

        Pushgateway.push(
          job: job,
          grouping: { service: ENV.fetch("OTEL_SERVICE_NAME", job) },
          metrics: body(job: job, status: status, duration_ms: duration_ms, extra: extra)
        )
      end

      private

      def body(job:, status:, duration_ms:, extra:)
        success = status == "success" ? 1 : 0
        lines = [
          "# HELP observability_job_last_success Job success state for the last cycle.",
          "# TYPE observability_job_last_success gauge",
          "observability_job_last_success #{success}",
          "# HELP observability_job_last_duration_ms Job duration for the last cycle.",
          "# TYPE observability_job_last_duration_ms gauge",
          "observability_job_last_duration_ms #{duration_ms.to_i}",
          "# HELP observability_job_last_run_timestamp_seconds Last job cycle timestamp.",
          "# TYPE observability_job_last_run_timestamp_seconds gauge",
          "observability_job_last_run_timestamp_seconds #{Time.now.to_f}",
        ]
        extra.each do |name, value|
          metric = "observability_job_#{name}"
          lines << "# TYPE #{metric} gauge"
          lines << "#{metric} #{numeric(value)}"
        end
        lines.join("\n") + "\n"
      end

      def numeric(value)
        Float(value)
      rescue
        0
      end
    end
  end
end
