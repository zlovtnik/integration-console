module IntegrationConsole
  module RedisConfig
    DEFAULT_URL = "redis://127.0.0.1:6379/1"

    module_function

    def options(env = ENV)
      options = {
        url: env.fetch("INTEGRATION_CONSOLE_REDIS_URL", DEFAULT_URL)
      }
      password = env["INTEGRATION_CONSOLE_REDIS_PASSWORD"]
      options[:password] = password if password && !password.empty?
      options
    end
  end
end
