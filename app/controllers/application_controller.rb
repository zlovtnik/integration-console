require "digest/sha1"

class ApplicationController < ActionController::Base
  include Paginatable
  include Sortable
  include GridFilterable

  rescue_from ActiveRecord::StatementInvalid, with: :render_query_error
  rescue_from ExportStore::Error, with: :render_export_store_error
  rescue_from IntegrationRun::InvalidTransitionError, with: :render_invalid_transition
  rescue_from ConsoleCommandDispatcher::ConflictError, with: :render_command_conflict
  rescue_from ConsoleCommandDispatcher::RejectedError, with: :render_command_rejection
  rescue_from ConsoleCommandDispatcher::TimeoutError, with: :render_command_unavailable
  rescue_from ConsoleCommandDispatcher::ProjectionUnavailableError, with: :render_command_unavailable

  private

  def dispatch_console_command(command_type:, aggregate_type:, aggregate_key:, payload:)
    idempotency_key = request.headers["Idempotency-Key"].presence ||
      [request.request_id, command_type, aggregate_key].join(":")
    acknowledgement = ConsoleCommandDispatcher.new(
      command_type:,
      aggregate_type:,
      aggregate_key:,
      payload:,
      idempotency_key:,
      requested_by: "rails:#{request.request_id}"
    ).call
    response.set_header("X-Console-Command-Id", acknowledgement.command_id)
    acknowledgement
  end

  def command_projection!(model, id)
    model.find(id)
  rescue ActiveRecord::RecordNotFound
    raise ConsoleCommandDispatcher::ProjectionUnavailableError,
      "Command succeeded but its core projection is not yet available"
  end

  def render_command_conflict(error)
    render_command_error(error, :conflict)
  end

  def render_command_rejection(error)
    render_command_error(error, :unprocessable_entity)
  end

  def render_command_unavailable(error)
    render_command_error(error, :service_unavailable)
  end

  def render_command_error(error, status)
    respond_to do |format|
      format.json { render json: { error: error.message }, status: }
      format.any { redirect_back fallback_location: root_path, alert: error.message, status: :see_other }
    end
  end

  def render_query_error(error)
    raise error unless tidb_timeout?(error)

    respond_to do |format|
      format.json { render json: { error: "Query timed out. Narrow the search and try again." }, status: :service_unavailable }
      format.any { render plain: "Query timed out. Narrow the search and try again.", status: :service_unavailable }
    end
  end

  def tidb_timeout?(error)
    message = [error.message, error.cause&.message].compact.join(" ").downcase
    message.include?("timeout") || message.include?("deadline exceeded") || message.include?("query execution was interrupted")
  end

  def render_export_store_error(error)
    Rails.logger.error("Export storage unavailable: #{error.class} - #{error.message}")

    respond_to do |format|
      format.json { render json: { error: "Export storage is unavailable. Try again later." }, status: :service_unavailable }
      format.any { render plain: "Export storage is unavailable. Try again later.", status: :service_unavailable }
    end
  end

  def render_invalid_transition(error)
    respond_to do |format|
      format.json { render json: { error: error.message }, status: :unprocessable_entity }
      format.any { redirect_back fallback_location: integration_runs_path, alert: error.message, status: :see_other }
    end
  end

  def render_cached_json(payload, browser_ttl:)
    expires_in browser_ttl, public: true
    etag = Digest::SHA1.hexdigest(payload.to_json)
    render json: payload if stale?(etag: etag, public: true)
  end

  def cache_bucket_time(seconds)
    Time.at((Time.current.to_i / seconds) * seconds).utc
  end
end
