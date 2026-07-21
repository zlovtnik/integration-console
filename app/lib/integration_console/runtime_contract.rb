require "uri"

module IntegrationConsole
  class RuntimeContract
    class Error < StandardError; end

    MYSQL_SCHEME = "mysql2"
    PRIMARY_DATABASE = "integration_console"
    SYNC_DATABASE = "octopus_core"
    LOOPBACK_HOSTS = %w[localhost 127.0.0.1 ::1].freeze

    def self.verify!(environment: ENV, production: Rails.env.production?)
      new(environment:, production:).verify!
    end

    def initialize(environment:, production:)
      @environment = environment
      @production = production
    end

    def verify!
      primary = mysql_url!("DATABASE_URL", PRIMARY_DATABASE)
      sync = mysql_url!("SYNC_DATABASE_URL", SYNC_DATABASE)
      redis_url!
      %w[SYNC_SCAN_CONSUMER SYNC_LOAD_CONSUMER SYNC_RESULT_CONSUMER].each do |name|
        add_error("#{name} is required") if production && environment[name].to_s.empty?
      end

      add_error("DATABASE_URL and SYNC_DATABASE_URL must not be identical") if primary.to_s == sync.to_s

      raise Error, errors.join("; ") if errors.any?

      true
    end

    private

    attr_reader :environment, :production

    def mysql_url!(name, expected_database)
      value = environment[name].to_s
      if value.empty?
        add_error("#{name} is required")
        return URI.parse("mysql2://missing.invalid/#{expected_database}")
      end

      uri = URI.parse(value)
      add_error("#{name} must use mysql2://") unless uri.scheme == MYSQL_SCHEME
      add_error("#{name} must select #{expected_database}") unless database_name(uri) == expected_database
      add_error("#{name} must include a non-root username") if uri.user.to_s.empty? || uri.user == "root"
      add_error("#{name} must include a password") if uri.password.to_s.empty?

      if production
        add_error("#{name} must use a non-loopback TiDB endpoint") if LOOPBACK_HOSTS.include?(uri.host.to_s.downcase)
        add_error("#{name} must set ssl_mode=VERIFY_IDENTITY") unless verify_identity?(uri)
      end

      uri
    rescue URI::InvalidURIError
      add_error("#{name} is not a valid URL")
      URI.parse("mysql2://missing.invalid/#{expected_database}")
    end

    def redis_url!
      value = environment["REDIS_URL"].to_s
      return add_error("REDIS_URL is required") if value.empty?

      uri = URI.parse(value)
      add_error("REDIS_URL must use redis:// or rediss://") unless %w[redis rediss].include?(uri.scheme)
    rescue URI::InvalidURIError
      add_error("REDIS_URL is not a valid URL")
    end

    def database_name(uri)
      uri.path.to_s.delete_prefix("/").split("/", 2).first
    end

    def verify_identity?(uri)
      params = URI.decode_www_form(uri.query.to_s).to_h.transform_keys(&:downcase)
      params.fetch("ssl_mode", params["sslmode"]).to_s.casecmp?("VERIFY_IDENTITY")
    end

    def add_error(message)
      errors << message
      nil
    end

    def errors
      @errors ||= []
    end
  end
end
