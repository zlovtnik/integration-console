module Observability
  class SensorHeartbeatLoop
    DEFAULT_INTERVAL_SECONDS = 60

    def self.run_forever
      interval = ENV.fetch("SENSOR_HEARTBEAT_MONITOR_INTERVAL_SECONDS", DEFAULT_INTERVAL_SECONDS).to_i
      interval = DEFAULT_INTERVAL_SECONDS if interval <= 0
      monitor = SensorHeartbeatMonitor.new

      loop do
        started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
        status = "success"
        begin
          monitor.call
        rescue => error
          status = "failure"
          Rails.logger.error("Sensor heartbeat monitor failed: #{error.class} #{error.message}")
        ensure
          duration_ms = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000.0).round
          Observability::JobMetrics.record(
            job: "integration_console_heartbeat",
            status: status,
            duration_ms: duration_ms
          )
        end
        sleep interval
      end
    end
  end
end
