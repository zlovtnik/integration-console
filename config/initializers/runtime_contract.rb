require Rails.root.join("app/lib/integration_console/runtime_contract")
require Rails.root.join("app/lib/integration_console/schema_readiness")

if Rails.env.production?
  IntegrationConsole::RuntimeContract.verify!
  Rails.application.config.after_initialize do
    IntegrationConsole::SchemaReadiness.verify!
  end
end
