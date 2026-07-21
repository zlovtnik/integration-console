module IntegrationConsole
  module CacheTtl
    module_function

    def inventory
      seconds("INTEGRATION_CONSOLE_CACHE_TTL_INVENTORY", 60)
    end

    def audit_recent
      seconds("INTEGRATION_CONSOLE_CACHE_TTL_AUDIT_RECENT", 10)
    end

    def dashboard
      seconds("INTEGRATION_CONSOLE_CACHE_TTL_DASHBOARD", 15)
    end

    def heatmap
      seconds("HEATMAP_REFRESH_INTERVAL_SECONDS", 300)
    end

    def seconds(name, default)
      value = ENV.fetch(name, default).to_i
      value = default if value <= 0
      value.seconds
    end
  end
end

cache_error_handler = lambda do |method:, returning:, exception:|
  Rails.logger.warn(
    "Redis cache #{method} failed; returning #{returning.inspect}: #{exception.class} #{exception.message}"
  )
end

Rails.application.config.cache_store = if Rails.env.test?
  :memory_store
elsif ENV["REDIS_URL"].present?
  [
    :redis_cache_store,
    {
      url: ENV.fetch("REDIS_URL"),
      namespace: ENV.fetch("REDIS_CACHE_NAMESPACE", "integration_console:cache"),
      expires_in: 60.seconds,
      connect_timeout: ENV.fetch("REDIS_CONNECT_TIMEOUT_SECONDS", "1").to_f,
      read_timeout: ENV.fetch("REDIS_READ_TIMEOUT_SECONDS", "1").to_f,
      write_timeout: ENV.fetch("REDIS_WRITE_TIMEOUT_SECONDS", "1").to_f,
      error_handler: cache_error_handler
    }
  ]
else
  :null_store
end
