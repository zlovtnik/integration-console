require "minitest/autorun"
require_relative "../../../app/lib/integration_console/redis_config"

class IntegrationConsole::RedisConfigTest < Minitest::Test
  def test_options_include_a_separately_supplied_password
    options = IntegrationConsole::RedisConfig.options(
      "INTEGRATION_CONSOLE_REDIS_URL" => "redis://redis:6379/1",
      "INTEGRATION_CONSOLE_REDIS_PASSWORD" => "secret"
    )

    assert_equal({ url: "redis://redis:6379/1", password: "secret" }, options)
  end

  def test_options_omit_the_password_when_it_is_unset
    options = IntegrationConsole::RedisConfig.options(
      "INTEGRATION_CONSOLE_REDIS_URL" => "redis://redis:6379/1"
    )

    assert_equal({ url: "redis://redis:6379/1" }, options)
  end
end
