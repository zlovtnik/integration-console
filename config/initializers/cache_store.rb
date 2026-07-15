require Rails.root.join("app/lib/integration_console/redis_config")

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

Rails.application.config.cache_store = if Rails.env.test?
  :memory_store
else
  [
    :redis_cache_store,
    IntegrationConsole::RedisConfig.options.merge(
      namespace: "ic",
      expires_in: 60.seconds
    )
  ]
end
