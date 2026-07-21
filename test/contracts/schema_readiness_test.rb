require_relative "../contract_test_helper"
require File.join(CONSOLE_ROOT, "app/lib/integration_console/schema_readiness")

class SchemaReadinessTest < Minitest::Test
  FakeConnection = Struct.new(:rows) do
    def quote(value)
      "'#{value}'"
    end

    def select_one(sql)
      key = sql.match(/WHERE (?:domain|component) = '([^']+)'/)[1]
      rows[key]
    end
  end

  def test_accepts_pinned_ready_domains
    rows = readiness_rows
    result = IntegrationConsole::SchemaReadiness.verify!(
      environment: readiness_environment,
      connections: {
        primary: FakeConnection.new(rows),
        sync: FakeConnection.new(rows)
      }
    )

    assert result.fetch(:ok)
    assert_equal %w[integration_console octopus_core atheros_search], result.fetch(:checks).map { |check| check.fetch(:domain) }
  end

  def test_rejects_checksum_drift
    rows = readiness_rows
    rows.fetch("octopus_core")["applied_checksum"] = "0" * 64

    error = assert_raises(IntegrationConsole::SchemaReadiness::Error) do
      IntegrationConsole::SchemaReadiness.verify!(
        environment: readiness_environment,
        connections: {
          primary: FakeConnection.new(rows),
          sync: FakeConnection.new(rows)
        }
      )
    end

    assert_includes error.message, "octopus_core"
    assert_includes error.message, "required/applied checksums disagree"
  end

  def test_requires_search_schema_and_tiflash_vector_readiness
    rows = readiness_rows
    rows.fetch("atheros-search")["vector_ready"] = 0

    error = assert_raises(IntegrationConsole::SchemaReadiness::Error) do
      IntegrationConsole::SchemaReadiness.verify!(
        environment: readiness_environment,
        connections: {
          primary: FakeConnection.new(rows),
          sync: FakeConnection.new(rows)
        }
      )
    end

    assert_includes error.message, "atheros_search"
    assert_includes error.message, "TiFlash vector schema is not marked ready"
  end

  def test_rejects_an_unrecognized_search_schema_version
    environment = readiness_environment.merge("ATHEROS_SEARCH_SCHEMA_VERSION" => "002")

    error = assert_raises(IntegrationConsole::SchemaReadiness::Error) do
      IntegrationConsole::SchemaReadiness.verify!(
        environment:,
        connections: {
          primary: FakeConnection.new(readiness_rows),
          sync: FakeConnection.new(readiness_rows)
        }
      )
    end

    assert_includes error.message, "atheros_search"
    assert_includes error.message, "unsupported schema version 002"
  end

  private

  def readiness_environment
    {
      "INTEGRATION_CONSOLE_SCHEMA_VERSION" => "001",
      "INTEGRATION_CONSOLE_SCHEMA_CHECKSUM" => "a" * 64,
      "OCTOPUS_CORE_SCHEMA_VERSION" => "2026072101",
      "OCTOPUS_CORE_SCHEMA_CHECKSUM" => "b" * 64,
      "ATHEROS_SEARCH_SCHEMA_VERSION" => "001",
      "ATHEROS_SEARCH_SCHEMA_CHECKSUM" => "c" * 64
    }
  end

  def readiness_rows
    {
      "integration_console" => ready_row("integration_console", "001", "a" * 64),
      "octopus_core" => ready_row("octopus_core", "2026072101", "b" * 64),
      "atheros-search" => {
        "component" => "atheros-search",
        "manifest_sha256" => "c" * 64,
        "schema_ready" => 1,
        "vector_ready" => 1,
        "updated_at" => Time.utc(2026, 7, 21)
      }
    }
  end

  def ready_row(domain, version, checksum)
    {
      "domain" => domain,
      "required_version" => version,
      "applied_version" => version,
      "required_checksum" => checksum,
      "applied_checksum" => checksum,
      "ready" => 1,
      "checked_at" => Time.utc(2026, 7, 21)
    }
  end
end
