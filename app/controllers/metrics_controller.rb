require "base64"

class MetricsController < ActionController::API
  before_action :authenticate_metrics!

  def show
    render plain: IntegrationConsole::Metrics.render, content_type: "text/plain; version=0.0.4"
  end

  private

  def authenticate_metrics!
    expected_username = ENV["METRICS_BASIC_AUTH_USERNAME"]
    expected_password = ENV["METRICS_BASIC_AUTH_PASSWORD"]
    return head :forbidden if expected_username.blank? || expected_password.blank?

    provided_username, provided_password = basic_auth_credentials
    return request_basic_authentication unless
      secure_compare(provided_username, expected_username) &&
      secure_compare(provided_password, expected_password)
  end

  def basic_auth_credentials
    scheme, encoded = request.authorization.to_s.split(" ", 2)
    return [nil, nil] unless scheme == "Basic" && encoded.present?

    decoded = Base64.strict_decode64(encoded)
    decoded.split(":", 2)
  rescue ArgumentError
    [nil, nil]
  end

  def secure_compare(actual, expected)
    actual.present? && expected.present? && ActiveSupport::SecurityUtils.secure_compare(actual, expected)
  end

  def request_basic_authentication
    response.set_header("WWW-Authenticate", 'Basic realm="Metrics"')
    head :unauthorized
  end
end
