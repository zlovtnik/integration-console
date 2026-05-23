class NetworkClientsController < ApplicationController
  include Sortable
  include Paginatable
  include GridFilterable

  SORTS = {
    "ssid" => "ssid",
    "client_mac" => "client_mac",
    "known_bssid" => "known_bssid",
    "first_seen" => "first_seen",
    "last_seen" => "last_seen",
    "probe_count" => "probe_count"
  }.freeze

  FILTERS = {
    "ssid" => "ssid",
    "client_mac" => "client_mac",
    "known_bssid" => "known_bssid",
    "first_seen" => { column: "first_seen", type: :date },
    "last_seen" => { column: "last_seen", type: :date },
    "probe_count" => { column: "probe_count", type: :number }
  }.freeze

  def index
    @query = params[:q].to_s.strip
    @wireless_clients = filtered_scope
    @wireless_clients = apply_sql_sort(@wireless_clients, SORTS, default_sort: :last_seen)
    @wireless_clients = paginate(@wireless_clients)

    respond_to do |format|
      format.html {
        raw_entries = @wireless_clients.to_a
        @wireless_clients_payload = wireless_clients_payload(raw_entries)
      }
      format.json {
        render json: {
          rows: @wireless_clients.as_json(only: [:ssid, :client_mac, :known_bssid, :first_seen, :last_seen, :probe_count]),
          totalCount: @total_count,
          currentPage: @current_page,
          perPage: @per_page,
          sortKey: @sort,
          sortDirection: @direction,
          filters: parsed_grid_filters
        }
      }
    end
  end

  private

  def filtered_scope
    scope = NetworkClient.all
    scope = scope.search(@query) if @query.present?
    scope = apply_grid_filters(scope, FILTERS)
    scope
  end

  def wireless_clients_payload(entries)
    {
      rows: entries.map { |entry| entry.as_json(only: [:ssid, :client_mac, :known_bssid, :first_seen, :last_seen, :probe_count]) },
      totalCount: @total_count,
      currentPage: @current_page,
      perPage: @per_page,
      sortKey: @sort,
      sortDirection: @direction,
      query: @query,
      filters: parsed_grid_filters,
      endpoints: {
        index: wireless_clients_path
      }
    }
  end
end
