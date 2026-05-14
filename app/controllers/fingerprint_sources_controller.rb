class FingerprintSourcesController < ApplicationController
  include Sortable
  include Paginatable
  include GridFilterable

  SORTS = {
    "device_fingerprint" => "device_fingerprint",
    "source_count" => "source_count",
    "first_seen" => "first_seen",
    "last_seen" => "last_seen"
  }.freeze

  FILTERS = {
    "device_fingerprint" => "device_fingerprint",
    "source_mac" => { expression: "source_macs::text" },
    "ssid" => { expression: "ssids::text" },
    "bssid" => { expression: "bssids::text" },
    "location_id" => { expression: "location_ids::text" },
    "sensor_id" => { expression: "sensor_ids::text" },
    "source_count" => { column: "source_count", type: :number },
    "first_seen" => { column: "first_seen", type: :date },
    "last_seen" => { column: "last_seen", type: :date }
  }.freeze

  def index
    @query = params[:q].to_s.strip
    @fingerprint_sources = filtered_scope
    @fingerprint_sources = apply_sort(@fingerprint_sources, SORTS, default_sort: :last_seen)
    @fingerprint_sources = paginate(@fingerprint_sources)

    respond_to do |format|
      format.html {
        raw_entries = @fingerprint_sources.to_a
        @fingerprint_sources_payload = fingerprint_sources_payload(raw_entries)
      }
      format.json {
        render json: {
          rows: @fingerprint_sources.map(&:as_json),
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
    scope = FingerprintSource.from("(#{FingerprintSource.aggregated.to_sql}) #{FingerprintSource.quoted_table_name}")
    scope = apply_grid_text_search(scope, FILTERS, @query) if @query.present?
    scope = apply_grid_filters(scope, FILTERS)
    scope
  end

  def fingerprint_sources_payload(entries)
    {
      rows: entries.map(&:as_json),
      totalCount: @total_count,
      currentPage: @current_page,
      perPage: @per_page,
      sortKey: @sort,
      sortDirection: @direction,
      query: @query,
      filters: parsed_grid_filters,
      endpoints: {
        index: fingerprint_sources_path,
        audit_logs: audit_logs_path
      }
    }
  end
end
