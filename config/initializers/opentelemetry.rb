if ENV["OTEL_EXPORTER_OTLP_ENDPOINT"].present? || ENV["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"].present?
  require "opentelemetry/sdk"
  require "opentelemetry/exporter/otlp"
  require "opentelemetry/instrumentation/rails"
  require "opentelemetry/instrumentation/active_record"
  require "opentelemetry/instrumentation/rack"
  require "opentelemetry/instrumentation/redis"
  require "opentelemetry/instrumentation/pg"

  OpenTelemetry::SDK.configure do |config|
    config.service_name = ENV.fetch("OTEL_SERVICE_NAME", "integration-console-web")
    config.sampler = OpenTelemetry::SDK::Trace::Samplers::ALWAYS_ON

    install = lambda do |name, options = {}|
      options.empty? ? config.use(name) : config.use(name, **options)
    rescue => error
      Rails.logger.warn("OpenTelemetry instrumentation #{name} disabled: #{error.class} #{error.message}")
    end

    install.call("OpenTelemetry::Instrumentation::Rails")
    install.call("OpenTelemetry::Instrumentation::ActiveRecord")
    install.call("OpenTelemetry::Instrumentation::Rack")
    install.call("OpenTelemetry::Instrumentation::Redis")
    install.call("OpenTelemetry::Instrumentation::PG", db_statement: :obfuscate)
  end

  OTEL_DB_TRACER = OpenTelemetry.tracer_provider.tracer("integration-console.active_record")

  ActiveSupport::Notifications.subscribe("sql.active_record") do |_name, started, finished, _id, payload|
    next if payload[:name] == "SCHEMA"

    operation = payload[:sql].to_s.strip.split(/\s+/, 2).first.to_s.upcase
    operation = "UNKNOWN" if operation.empty?
    span = OTEL_DB_TRACER.start_span(
      "db.client.operation",
      start_timestamp: started,
      attributes: {
        "db.system" => "postgresql",
        "db.operation" => operation,
        "db.name" => integration_console_db_name,
        "status" => payload[:exception].present? ? "error" : "ok",
      }
    )
    span.finish(end_timestamp: finished)
  rescue => error
    Rails.logger.debug("OpenTelemetry ActiveRecord span skipped: #{error.class} #{error.message}")
  end
end

def integration_console_db_name
  ActiveRecord::Base.connection_db_config.database.presence || "integration_console"
rescue
  "integration_console"
end
