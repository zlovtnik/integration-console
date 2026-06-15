module Observability
  class HeatmapRefreshLoop
    DEFAULT_INTERVAL_SECONDS = 300

    def self.run_forever
      interval = ENV.fetch("HEATMAP_REFRESH_INTERVAL_SECONDS", DEFAULT_INTERVAL_SECONDS).to_i
      interval = DEFAULT_INTERVAL_SECONDS if interval <= 0

      loop do
        started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
        status = "success"
        refreshed = false
        begin
          refreshed = WirelessHeatmap.refresh!
        rescue => error
          status = "failure"
          Rails.logger.error("Heatmap refresh failed: #{error.class} #{error.message}")
        ensure
          duration_ms = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000.0).round
          Observability::JobMetrics.record(
            job: "integration_console_heatmap_refresh",
            status: status,
            duration_ms: duration_ms,
            extra: { refreshed: refreshed ? 1 : 0 }
          )
        end
        sleep interval
      end
    end
  end
end
