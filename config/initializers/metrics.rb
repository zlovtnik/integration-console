ActiveSupport::Notifications.subscribe("process_action.action_controller") do |_name, started, finished, _id, payload|
  IntegrationConsole::Metrics.observe_http(
    controller: payload[:controller],
    action: payload[:action],
    method: payload[:method],
    status: payload[:status] || 500,
    duration_ms: (finished - started) * 1000.0
  )
end

ActiveSupport::Notifications.subscribe("sql.active_record") do |_name, started, finished, _id, payload|
  next if payload[:name] == "SCHEMA"

  IntegrationConsole::Metrics.observe_sql(
    sql: payload[:sql],
    cached: payload[:cached],
    duration_ms: (finished - started) * 1000.0
  )
end

ActiveSupport::Notifications.subscribe(/cache_(read|write|delete|fetch_hit|generate|fetch_miss)\.active_support/) do |name, _started, _finished, _id, _payload|
  IntegrationConsole::Metrics.observe_cache(operation: name.split(".").first)
end
