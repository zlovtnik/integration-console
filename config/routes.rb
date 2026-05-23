Rails.application.routes.draw do
  root "dashboard#index"
  get "/health", to: "health#show"
  get "/health/cards", to: "dashboard#cards"
  get "/health/sync_data", to: "health#sync_data"
  get "/health/sensors", to: "health#sensors"
  get "/health/redpanda", to: "health#redpanda"
  get "/health/redpanda_samples", to: "health#redpanda_samples"
  get "/health/recent_alerts", to: "health#recent_alerts"

  resources :audit_logs, only: %i[index show] do
    get :recent, on: :collection
    get :export, on: :collection
  end
  resources :backlog, only: :index do
    post :retry, on: :member
  end
  resources :audit_windows
  resources :integrations do
    member do
      post :trigger
      post :replay
    end
    collection do
      get :lineage
      get :param_types
    end
  end
  resources :integration_runs, only: %i[index show] do
    member do
      post :cancel
    end
    get :batches, to: "integration_run_batches#index"
  end
  resources :wireless_authorized_networks
  resources :devices
  resources :identities, only: :index do
    get :inventory, on: :collection
    get :mac_summary, on: :collection
    get :distinct_values, on: :collection
  end
  resources :heatmap, only: :index
  resources :alerts, only: :index
  resources :wireless_shadow_alerts, only: :index do
    get :distinct_values, on: :collection
  end
  resources :wireless_clients, only: :index
  resources :fingerprint_sources, only: :index

  mount ActionCable.server => "/cable"
end
