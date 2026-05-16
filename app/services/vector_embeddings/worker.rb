require "digest"
require "json"
require "socket"

module VectorEmbeddings
  class Worker
    POLL_INTERVAL_SECONDS = 5

    def initialize(config: Config.from_env, connection: SyncRecord.connection, embedding_client: nil, text_builder: nil, logger: Rails.logger)
      @config = config
      @connection = connection
      @embedding_client = embedding_client || build_embedding_client
      @text_builder = text_builder || TextBuilder.new(connection: connection)
      @logger = logger
      @running = false
    end

    def run_forever
      unless config.enabled
        logger.info("[VectorEmbeddings] disabled; set VECTOR_EMBEDDINGS_ENABLED=true to run")
        return
      end

      @running = true
      logger.info("[VectorEmbeddings] starting worker model=#{config.model} dimensions=#{config.dimensions}")
      while @running
        processed = run_once
        sleep POLL_INTERVAL_SECONDS if @running && processed.zero?
      end
    end

    def stop
      @running = false
    end

    def run_once
      return 0 unless config.enabled

      mark_state(status: "running", started: true)
      jobs = lease_jobs
      process_jobs(jobs)
      mark_state(status: "idle", finished: true)
      jobs.size
    rescue => e
      mark_state(status: "failed", last_error: "#{e.class}: #{e.message}", finished: true) rescue nil
      raise
    end

    private

    attr_reader :config, :connection, :embedding_client, :text_builder, :logger

    def build_embedding_client
      raise ArgumentError, "unsupported vector embedding provider: #{config.provider}" unless config.provider == "ollama"

      OllamaClient.new(base_url: config.url, model: config.model)
    end

    def lease_jobs
      connection.exec_query(<<~SQL.squish).to_a
        SELECT *
        FROM vec_lease_embedding_jobs(
          #{Integer(config.batch_size)},
          #{connection.quote(config.worker_name)},
          make_interval(secs => #{Integer(config.lease_seconds)})
        )
      SQL
    end

    def process_jobs(jobs)
      jobs.each_slice(request_batch_size) { |batch| process_batch(batch) }
    end

    def request_batch_size
      [Integer(config.request_batch_size), 1].max
    end

    def process_batch(jobs)
      prepared = []
      prepared = prepare_jobs(jobs)
      return if prepared.empty?

      mark_state(status: "running", last_cursor: batch_cursor(prepared))
      vectors = embed_texts(prepared.map { |item| item.fetch(:input).text })
      raise ArgumentError, "embedding response count mismatch: expected #{prepared.length}, got #{vectors.length}" unless vectors.length == prepared.length

      prepared.zip(vectors).each { |item, vector| complete_prepared_job(item, vector) }
    rescue => e
      prepared.each { |item| record_processed_failure(item.fetch(:job), e) }
    end

    def prepare_jobs(jobs)
      jobs.filter_map do |job|
        prepare_job(job)
      rescue => e
        record_processed_failure(job, e)
        nil
      end
    end

    def prepare_job(job)
      input = text_builder.build(job)
      content_sha256 = Digest::SHA256.hexdigest(input.text)
      { job:, input:, content_sha256: }
    end

    def complete_prepared_job(item, vector)
      job = item.fetch(:job)
      validate_dimensions!(vector)

      connection.transaction do
        upsert_embedding(job, item.fetch(:input), item.fetch(:content_sha256), vector)
        complete_job(job.fetch("job_id"), item.fetch(:content_sha256))
      end
    rescue => e
      record_processed_failure(job, e)
    else
      record_processed_success(job)
    end

    def embed_texts(texts)
      return embedding_client.embed_many(texts) if embedding_client.respond_to?(:embed_many)

      texts.map { |text| embedding_client.embed(text) }
    end

    def validate_dimensions!(vector)
      return if vector.length == config.dimensions

      raise ArgumentError, "embedding dimension mismatch: expected #{config.dimensions}, got #{vector.length}"
    end

    def upsert_embedding(job, input, content_sha256, vector)
      metadata = input.metadata.compact
      vector_literal = "[#{vector.map { |value| Float(value) }.join(",")}]"
      connection.execute(<<~SQL.squish)
        INSERT INTO vec_embeddings (
          source_table, source_key, source_observed_at, source_stream_name, source_sensor_id,
          source_location_id, source_mac, embedding_model, embedding_kind, embedding_dimensions,
          content_sha256, content_text, embedding, metadata, embedded_at, created_at, updated_at
        )
        VALUES (
          #{connection.quote(job.fetch("source_table"))},
          #{connection.quote(job.fetch("source_key"))},
          #{quote_nullable_time(metadata[:source_observed_at])},
          #{connection.quote(metadata[:source_stream_name])},
          #{connection.quote(metadata[:source_sensor_id])},
          #{connection.quote(metadata[:source_location_id])},
          #{connection.quote(metadata[:source_mac])},
          #{connection.quote(job.fetch("embedding_model"))},
          #{connection.quote(job.fetch("embedding_kind"))},
          #{Integer(config.dimensions)},
          #{connection.quote(content_sha256)},
          #{connection.quote(input.text)},
          #{connection.quote(vector_literal)}::vector,
          #{connection.quote(JSON.generate(metadata))}::jsonb,
          now(),
          now(),
          now()
        )
        ON CONFLICT (source_table, source_key, embedding_model, embedding_kind) DO UPDATE SET
          source_observed_at = EXCLUDED.source_observed_at,
          source_stream_name = EXCLUDED.source_stream_name,
          source_sensor_id = EXCLUDED.source_sensor_id,
          source_location_id = EXCLUDED.source_location_id,
          source_mac = EXCLUDED.source_mac,
          embedding_dimensions = EXCLUDED.embedding_dimensions,
          content_sha256 = EXCLUDED.content_sha256,
          content_text = EXCLUDED.content_text,
          embedding = EXCLUDED.embedding,
          metadata = EXCLUDED.metadata,
          embedded_at = now(),
          updated_at = now()
      SQL
    end

    def complete_job(job_id, content_sha256)
      connection.execute(<<~SQL.squish)
        UPDATE vec_embedding_jobs
        SET status = 'completed',
            content_sha256 = #{connection.quote(content_sha256)},
            completed_at = now(),
            lease_token = NULL,
            leased_at = NULL,
            locked_by = NULL,
            last_error = NULL,
            updated_at = now()
        WHERE job_id = #{Integer(job_id)}
      SQL
    end

    def fail_job(job, error)
      connection.execute(<<~SQL.squish)
        UPDATE vec_embedding_jobs
        SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
            lease_token = NULL,
            leased_at = NULL,
            locked_by = NULL,
            last_error = #{connection.quote("#{error.class}: #{error.message}".truncate(1000))},
            due_at = now() + make_interval(secs => least(300, greatest(10, attempts * 10))),
            updated_at = now()
        WHERE job_id = #{Integer(job.fetch("job_id"))}
      SQL
    end

    def record_failed_job(job, error)
      fail_job(job, error)
      logger.error("[VectorEmbeddings] job #{job["job_id"]} failed: #{error.class} #{error.message}")
    rescue => failure_update_error
      logger.error(
        "[VectorEmbeddings] job #{job["job_id"]} failed: #{error.class} #{error.message}; " \
        "could not update failure state: #{failure_update_error.class} #{failure_update_error.message}"
      )
    end

    def record_processed_success(job)
      mark_state(status: "running", rows_processed: 1, last_cursor: job_cursor(job))
    end

    def record_processed_failure(job, error)
      record_failed_job(job, error)
      mark_state(
        status: "running",
        rows_processed: 1,
        last_cursor: job_cursor(job),
        last_error: "#{error.class}: #{error.message}".truncate(1000)
      )
    end

    def batch_cursor(prepared)
      job_ids = prepared.map { |item| item.fetch(:job).fetch("job_id") }
      "batch:#{job_ids.first}-#{job_ids.last}"
    end

    def job_cursor(job)
      "job:#{job.fetch("job_id")}"
    end

    def mark_state(status:, started: false, finished: false, rows_processed: nil, last_error: nil, last_cursor: nil)
      connection.execute(<<~SQL.squish)
        INSERT INTO vec_worker_state (
          worker_name, status, last_cursor, last_run_started_at, last_run_finished_at, rows_processed, last_error, updated_at
        )
        VALUES (
          #{connection.quote(config.worker_name)},
          #{connection.quote(status)},
          #{connection.quote(last_cursor)},
          #{started ? "now()" : "NULL"},
          #{finished ? "now()" : "NULL"},
          #{Integer(rows_processed || 0)},
          #{connection.quote(last_error)},
          now()
        )
        ON CONFLICT (worker_name) DO UPDATE SET
          status = EXCLUDED.status,
          last_cursor = COALESCE(EXCLUDED.last_cursor, vec_worker_state.last_cursor),
          last_run_started_at = COALESCE(EXCLUDED.last_run_started_at, vec_worker_state.last_run_started_at),
          last_run_finished_at = COALESCE(EXCLUDED.last_run_finished_at, vec_worker_state.last_run_finished_at),
          rows_processed = CASE
            WHEN EXCLUDED.rows_processed > 0 THEN vec_worker_state.rows_processed + EXCLUDED.rows_processed
            ELSE vec_worker_state.rows_processed
          END,
          last_error = EXCLUDED.last_error,
          updated_at = now()
      SQL
    end

    def quote_nullable_time(value)
      return "NULL" if value.blank?

      connection.quote(value)
    end
  end
end
