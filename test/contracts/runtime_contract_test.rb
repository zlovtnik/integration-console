require_relative "../contract_test_helper"
require File.join(CONSOLE_ROOT, "app/lib/integration_console/runtime_contract")

class RuntimeContractTest < Minitest::Test
  def test_accepts_isolated_verified_tidb_urls
    assert IntegrationConsole::RuntimeContract.verify!(
      environment: valid_environment,
      production: true
    )
  end

  def test_accepts_one_least_privilege_rails_account_for_both_databases
    environment = valid_environment.merge(
      "SYNC_DATABASE_URL" => "mysql2://console_writer:secret@tidb.example/octopus_core?ssl_mode=VERIFY_IDENTITY"
    )

    assert IntegrationConsole::RuntimeContract.verify!(environment:, production: true)
  end

  def test_rejects_unverified_tls
    environment = valid_environment.merge(
      "SYNC_DATABASE_URL" => "mysql2://console_writer:secret@tidb.example/octopus_core?ssl_mode=REQUIRED"
    )

    error = assert_raises(IntegrationConsole::RuntimeContract::Error) do
      IntegrationConsole::RuntimeContract.verify!(environment:, production: true)
    end

    assert_includes error.message, "VERIFY_IDENTITY"
  end

  def test_rejects_wrong_scheme_database_root_and_loopback
    environment = valid_environment.merge(
      "DATABASE_URL" => "postgres://root:secret@127.0.0.1/octopus_core"
    )

    error = assert_raises(IntegrationConsole::RuntimeContract::Error) do
      IntegrationConsole::RuntimeContract.verify!(environment:, production: true)
    end

    assert_includes error.message, "mysql2://"
    assert_includes error.message, "must select integration_console"
    assert_includes error.message, "non-root"
    assert_includes error.message, "non-loopback"
  end

  private

  def valid_environment
    {
      "DATABASE_URL" => "mysql2://console_writer:secret@tidb.example/integration_console?ssl_mode=VERIFY_IDENTITY",
      "SYNC_DATABASE_URL" => "mysql2://console_reader:secret@tidb.example/octopus_core?ssl_mode=VERIFY_IDENTITY",
      "REDIS_URL" => "redis://redis.internal:6379/0",
      "SYNC_SCAN_CONSUMER" => "octopus-scan-v2",
      "SYNC_LOAD_CONSUMER" => "octopus-load-v2",
      "SYNC_RESULT_CONSUMER" => "octopus-result-v2"
    }
  end
end
