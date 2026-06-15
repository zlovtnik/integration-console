class MetricsController < ActionController::API
  def show
    render plain: IntegrationConsole::Metrics.render, content_type: "text/plain; version=0.0.4"
  end
end
