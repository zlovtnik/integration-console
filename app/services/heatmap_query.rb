class HeatmapQuery
  MAX_FILTERS = 10
  VISUAL_LOCATIONS_LIMIT = 200

  FILTERS = {
    "location_id" => "location_id",
    "event_count" => { column: "event_count", type: :number },
    "avg_signal_dbm" => { column: "avg_signal_dbm", type: :number },
    "unique_devices" => { column: "unique_devices", type: :number },
    "last_seen_at" => { column: "last_seen_at", type: :date }
  }.freeze

  ALLOWED_SORT_COLUMNS = %w[location_id event_count avg_signal_dbm unique_devices last_seen_at].freeze

  def initialize(sort_expression:, direction:, first_rank:, last_rank:, filters:)
    @sort_expression = validate_sort_column(sort_expression)
    @direction = validate_direction(direction)
    @first_rank = validate_rank(first_rank)
    @last_rank = validate_rank(last_rank)
    @filters = filters
  end

  def execute
    rows = paginated_rows
    visual_rows = cached_visual_rows
    total_count = rows.first&.fetch("total_count", 0).to_i
    total_pages = [(total_count.to_f / paginated_page_size).ceil, 1].max
    last_refreshed_at = rows.first&.fetch("last_refreshed_at", nil)

    {
      rows: rows.map { |r| serialize_result(r) },
      visualLocations: visual_rows,
      totalCount: total_count,
      totalPages: total_pages,
      lastRefreshedAt: last_refreshed_at
    }
  end

  private

  attr_reader :sort_expression, :direction, :first_rank, :last_rank, :filters

  def paginated_page_size
    last_rank - first_rank + 1
  end

  def paginated_rows
    WirelessHeatmap.connection.exec_query(paginated_sql).to_a
  end

  def paginated_sql
    <<~SQL
      SELECT
        location_id,
        event_count,
        avg_signal_dbm,
        unique_devices,
        last_seen_at,
        page_rank AS result_rank,
        #{paginated_window_over}
      FROM (
        SELECT
          location_id,
          event_count,
          avg_signal_dbm,
          unique_devices,
          last_seen_at,
          row_number() OVER (ORDER BY #{sort_expression} #{direction.upcase}) AS page_rank
        FROM mv_wireless_heatmap
        #{where_clause}
      ) sub
      WHERE page_rank BETWEEN #{first_rank} AND #{last_rank}
      ORDER BY page_rank ASC
    SQL
  end

  def paginated_window_over
    # Compute total_count and last_refreshed_at from the *filtered* set,
    # but avoid a second full-scan by using an inline subquery.
    "(SELECT count(*) FROM mv_wireless_heatmap #{where_clause}) AS total_count,
     (SELECT max(last_seen_at) FROM mv_wireless_heatmap #{where_clause}) AS last_refreshed_at"
  end

  def cached_visual_rows
    cache_key = "heatmap:visual:#{Digest::SHA1.hexdigest(filters.to_s)}"
    Rails.cache.fetch(cache_key, expires_in: IntegrationConsole::CacheTtl.heatmap) do
      visual_rows
    end
  end

  def visual_rows
    WirelessHeatmap.connection.exec_query(visual_sql).to_a.map { |r| serialize_result(r) }
  end

  def visual_sql
    <<~SQL
      SELECT
        location_id,
        event_count,
        avg_signal_dbm,
        unique_devices,
        last_seen_at,
        visual_rank AS result_rank
      FROM (
        SELECT
          location_id,
          event_count,
          avg_signal_dbm,
          unique_devices,
          last_seen_at,
          row_number() OVER (ORDER BY event_count DESC) AS visual_rank
        FROM mv_wireless_heatmap
        #{where_clause}
      ) sub
      WHERE visual_rank <= #{VISUAL_LOCATIONS_LIMIT}
      ORDER BY visual_rank ASC
    SQL
  end

  def serialize_result(row)
    {
      location_id: row["location_id"],
      event_count: row["event_count"].to_i,
      avg_signal_dbm: row["avg_signal_dbm"]&.to_f,
      unique_devices: row["unique_devices"].to_i,
      last_seen_at: row["last_seen_at"]
    }
  end

  def where_clause
    return "" if filters.blank?

    clauses = []
    binds = []

    filters.first(MAX_FILTERS).each do |filter|
      field = filter["field"].to_s
      config = FILTERS[field]
      next unless config

      column = filter_column_sql(config)
      type = filter_type(config)
      clause, values = grid_filter_clause(column, type, filter["operator"].to_s, filter["value"])
      next if clause.blank?

      conjunction = filter["conjunction"].to_s == "OR" ? "OR" : "AND"
      clauses << { sql: clause, conjunction: conjunction }
      binds.concat(values)
    end

    return "" if clauses.blank?

    sql = clauses.each_with_index.map do |clause, index|
      prefix = index.zero? ? "" : "#{clause[:conjunction]} "
      "#{prefix}(#{clause[:sql]})"
    end.join(" ")

    sanitized = WirelessHeatmap.sanitize_sql_array([sql, *binds])
    "WHERE #{sanitized}"
  end

  def params
    { filters: filters.to_json }
  end

  def validate_sort_column(column)
    ALLOWED_SORT_COLUMNS.include?(column.to_s) ? column.to_s : "event_count"
  end

  def validate_direction(dir)
    dir.to_s.upcase == "ASC" ? "ASC" : "DESC"
  end

  def validate_rank(rank)
    [[rank.to_i, 1].max, 100_000].min
  end

  def filter_column_sql(config)
    column = config.is_a?(Hash) ? config.fetch(:column) : config
    column.to_s
  end

  def filter_type(config)
    return :text unless config.is_a?(Hash)
    (config[:type] || :text).to_sym
  end

  def grid_filter_clause(column, type, operator, value)
    return empty_clause(column, false) if operator == "is_empty"
    return empty_clause(column, true) if operator == "is_not_empty"

    case type
    when :number
      numeric_clause(column, operator, value)
    when :date
      date_clause(column, operator, value)
    else
      text_clause(column, operator, value)
    end
  end

  def text_clause(column, operator, value)
    text_value = value.to_s
    return [nil, []] if text_value.blank?

    normalized = text_value.downcase
    expression = "LOWER(CAST(#{column} AS TEXT))"

    case operator
    when "equals"
      ["#{expression} = ?", [normalized]]
    when "starts_with"
      ["#{expression} LIKE ?", ["#{sanitize_like(normalized)}%"]]
    when "not_equals"
      ["#{expression} != ?", [normalized]]
    else
      ["#{expression} LIKE ?", ["%#{sanitize_like(normalized)}%"]]
    end
  end

  def numeric_clause(column, operator, value)
    number = Float(value.to_s.strip)
    case operator
    when "greater_than"
      ["#{column} > ?", [number]]
    when "less_than"
      ["#{column} < ?", [number]]
    else
      ["#{column} = ?", [number]]
    end
  rescue ArgumentError, TypeError
    [nil, []]
  end

  def date_clause(column, operator, value)
    date = Date.iso8601(value.to_s)
    expression = "DATE(#{column})"

    case operator
    when "after"
      ["#{expression} > ?", [date]]
    when "before"
      ["#{expression} < ?", [date]]
    else
      ["#{expression} = ?", [date]]
    end
  rescue ArgumentError, TypeError
    [nil, []]
  end

  def empty_clause(column, negate)
    clause = "(#{column} IS NULL OR CAST(#{column} AS TEXT) = '')"
    negate ? ["NOT #{clause}", []] : [clause, []]
  end

  def sanitize_like(value)
    ActiveRecord::Base.sanitize_sql_like(value)
  end
end
