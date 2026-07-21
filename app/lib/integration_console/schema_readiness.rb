module IntegrationConsole
  class SchemaReadiness
    class Error < StandardError; end

    SEARCH_SCHEMA_VERSION = "001"

    Check = Data.define(:domain, :connection, :table, :version_env, :checksum_env, :layout)

    CHECKS = [
      Check.new(
        domain: "integration_console",
        connection: :primary,
        table: "schema_readiness",
        version_env: "INTEGRATION_CONSOLE_SCHEMA_VERSION",
        checksum_env: "INTEGRATION_CONSOLE_SCHEMA_CHECKSUM",
        layout: :readiness
      ),
      Check.new(
        domain: "octopus_core",
        connection: :sync,
        table: "schema_readiness",
        version_env: "OCTOPUS_CORE_SCHEMA_VERSION",
        checksum_env: "OCTOPUS_CORE_SCHEMA_CHECKSUM",
        layout: :readiness
      ),
      Check.new(
        domain: "atheros_search",
        connection: :sync,
        table: "atheros_search.schema_manifest",
        version_env: "ATHEROS_SEARCH_SCHEMA_VERSION",
        checksum_env: "ATHEROS_SEARCH_SCHEMA_CHECKSUM",
        layout: :search_manifest
      )
    ].freeze

    def self.verify!(environment: ENV, connections: nil)
      new(environment:, connections:).verify!
    end

    def self.status(environment: ENV, connections: nil)
      new(environment:, connections:).status
    end

    def initialize(environment:, connections: nil)
      @environment = environment
      @connections = connections
    end

    def verify!
      result = status
      failures = result.fetch(:checks).reject { |check| check.fetch(:ok) }
      return result if failures.empty?

      raise Error, failures.map { |check| "#{check.fetch(:domain)}: #{check.fetch(:message)}" }.join("; ")
    end

    def status
      checks = CHECKS.map { |check| check_status(check) }
      { ok: checks.all? { |check| check.fetch(:ok) }, checks: }
    end

    private

    attr_reader :environment

    def check_status(check)
      expected_version = required_environment!(check.version_env)
      expected_checksum = required_environment!(check.checksum_env).downcase
      return search_manifest_status(check, expected_version, expected_checksum) if check.layout == :search_manifest

      readiness_status(check, expected_version, expected_checksum)
    rescue KeyError, ActiveRecord::ActiveRecordError => error
      failed(check, error.message)
    end

    def readiness_status(check, expected_version, expected_checksum)
      row = select_readiness(check)
      return failed(check, "readiness row is missing") unless row
      return failed(check, "schema is not marked ready") unless truthy?(row.fetch("ready"))
      return failed(check, "required/applied versions disagree") unless row.fetch("required_version") == row.fetch("applied_version")
      return failed(check, "required/applied checksums disagree") unless normalized_checksum(row.fetch("required_checksum")) == normalized_checksum(row.fetch("applied_checksum"))
      return failed(check, "expected version #{expected_version}, got #{row.fetch("applied_version")}") unless row.fetch("applied_version") == expected_version
      return failed(check, "applied checksum does not match the repository manifest") unless normalized_checksum(row.fetch("applied_checksum")) == expected_checksum

      {
        domain: check.domain,
        ok: true,
        version: row.fetch("applied_version"),
        checksum: normalized_checksum(row.fetch("applied_checksum")),
        checked_at: row["checked_at"]
      }
    end

    def search_manifest_status(check, expected_version, expected_checksum)
      return failed(check, "unsupported schema version #{expected_version}") unless expected_version == SEARCH_SCHEMA_VERSION

      row = select_search_manifest(check)
      return failed(check, "schema manifest row is missing") unless row
      return failed(check, "search schema is not marked ready") unless truthy?(row.fetch("schema_ready"))
      return failed(check, "TiFlash vector schema is not marked ready") unless truthy?(row.fetch("vector_ready"))

      applied_checksum = normalized_checksum(row.fetch("manifest_sha256"))
      return failed(check, "applied checksum does not match the repository manifest") unless applied_checksum == expected_checksum

      {
        domain: check.domain,
        ok: true,
        version: expected_version,
        checksum: applied_checksum,
        checked_at: row["updated_at"]
      }
    end

    def select_readiness(check)
      connection = connections.fetch(check.connection)
      quoted_domain = connection.quote(check.domain)
      connection.select_one(<<~SQL.squish)
        SELECT domain, required_version, applied_version,
               required_checksum, applied_checksum, ready, checked_at
        FROM #{check.table}
        WHERE domain = #{quoted_domain}
        LIMIT 1
      SQL
    end

    def select_search_manifest(check)
      connection = connections.fetch(check.connection)
      component = connection.quote("atheros-search")
      connection.select_one(<<~SQL.squish)
        SELECT component, manifest_sha256, schema_ready, vector_ready, updated_at
        FROM #{check.table}
        WHERE component = #{component}
        LIMIT 1
      SQL
    end

    def connections
      @connections ||= {
        primary: ApplicationRecord.connection,
        sync: SyncRecord.connection
      }
    end

    def required_environment!(name)
      value = environment[name].to_s
      raise KeyError, "#{name} is required" if value.empty?

      value
    end

    def normalized_checksum(value)
      value.to_s.downcase
    end

    def truthy?(value)
      ActiveModel::Type::Boolean.new.cast(value)
    end

    def failed(check, message)
      { domain: check.domain, ok: false, message: }
    end
  end
end
