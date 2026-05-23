class ShadowItAlertsController < ApplicationController
  include GridFilterable

  SORTS = {
    "last_occurred_at" => :last_occurred_at,
    "source_mac" => :source_mac,
    "destination_bssid" => :destination_bssid,
    "ssid" => :ssid,
    "sensor_id" => :sensor_id,
    "location_id" => :location_id,
    "signal_dbm" => :signal_dbm,
    "reason" => :reason,
    "resolved_at" => :resolved_at
  }.freeze

  FILTERS = {
    "source_mac" => :source_mac,
    "destination_bssid" => :destination_bssid,
    "ssid" => :ssid,
    "sensor_id" => :sensor_id,
    "location_id" => :location_id,
    "reason" => :reason,
    "signal_dbm" => { column: :signal_dbm, type: :number },
    "last_occurred_at" => { column: :last_occurred_at, type: :date },
    "resolved_at" => { column: :resolved_at, type: :date }
  }.freeze

  def index
    @query = params[:q].to_s.strip
    @wireless_shadow_alerts = ShadowItAlert.recent
    @wireless_shadow_alerts = @wireless_shadow_alerts.search(@query) if @query.present?
    @wireless_shadow_alerts = apply_grid_filters(@wireless_shadow_alerts, FILTERS)
    @wireless_shadow_alerts = apply_sort(@wireless_shadow_alerts, SORTS, default_sort: :last_occurred_at)
    @wireless_shadow_alerts = paginate(@wireless_shadow_alerts)
  end

  def distinct_values
    field = params[:field].to_s
    allowed_fields = %w[source_mac destination_bssid ssid sensor_id location_id reason]
    
    if allowed_fields.include?(field)
      values = Rails.cache.fetch("wireless_shadow_alerts:distinct:#{field}", expires_in: 60.seconds) do
        ShadowItAlert.where.not(field => nil).distinct.order(field).limit(100).pluck(field)
      end
      render json: values
    else
      render json: [], status: :bad_request
    end
  end
end
