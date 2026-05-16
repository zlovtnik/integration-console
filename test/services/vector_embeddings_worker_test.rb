require "test_helper"

class VectorEmbeddingsWorkerTest < ActiveSupport::TestCase
  FakeResult = Struct.new(:rows) do
    def to_a
      rows
    end
  end

  FakeInput = Struct.new(:text, :metadata, keyword_init: true)

  class FakeConnection
    attr_reader :queries, :statements

    def initialize(jobs, raise_on_failure_update: false)
      @jobs = jobs
      @raise_on_failure_update = raise_on_failure_update
      @queries = []
      @statements = []
    end

    def exec_query(sql, _name = nil)
      @queries << sql
      FakeResult.new(sql.include?("vec_lease_embedding_jobs") ? @jobs : [])
    end

    def execute(sql)
      @statements << sql
      raise ActiveRecord::LockWaitTimeout, "lock timeout" if @raise_on_failure_update && sql.include?("status = CASE")
    end

    def transaction
      yield
    end

    def quote(value)
      return "NULL" if value.nil?

      "'#{value.to_s.gsub("'", "''")}'"
    end
  end

  class FakeTextBuilder
    def initialize(input)
      @input = input
    end

    def build(_job)
      @input
    end
  end

  class FakeEmbeddingClient
    attr_reader :embed_many_requests

    def initialize(vector)
      @vector = vector
      @embed_many_requests = []
    end

    def embed(_text)
      @vector
    end

    def embed_many(texts)
      @embed_many_requests << texts
      texts.map { @vector }
    end
  end

  test "leases jobs and upserts completed embeddings" do
    job = {
      "job_id" => 7,
      "source_table" => "sync_scan_ingest",
      "source_key" => "event-1",
      "embedding_model" => "nomic-embed-text-v2-moe",
      "embedding_kind" => "event"
    }
    connection = FakeConnection.new([job])
    input = FakeInput.new(
      text: "kind: event\nsource_mac: aa:bb:cc:dd:ee:ff",
      metadata: { source_mac: "aa:bb:cc:dd:ee:ff", source_sensor_id: "sensor-1" }
    )
    worker = worker(connection:, input:, vector: [0.1, 0.2, 0.3])

    assert_equal 1, worker.run_once
    assert connection.queries.any? { |sql| sql.include?("vec_lease_embedding_jobs( 2, 'test-worker', make_interval(secs => 1800) )") }
    assert connection.statements.any? { |sql| sql.include?("INSERT INTO vec_embeddings") && sql.include?("ON CONFLICT") }
    assert connection.statements.any? { |sql| sql.include?("UPDATE vec_embedding_jobs") && sql.include?("status = 'completed'") }
  end

  test "embeds leased jobs in request batches and records progress per job" do
    jobs = [
      {
        "job_id" => 10,
        "source_table" => "sync_scan_ingest",
        "source_key" => "event-10",
        "embedding_model" => "nomic-embed-text-v2-moe",
        "embedding_kind" => "event"
      },
      {
        "job_id" => 11,
        "source_table" => "sync_scan_ingest",
        "source_key" => "event-11",
        "embedding_model" => "nomic-embed-text-v2-moe",
        "embedding_kind" => "event"
      }
    ]
    connection = FakeConnection.new(jobs)
    input = FakeInput.new(text: "kind: event", metadata: {})
    embedding_client = FakeEmbeddingClient.new([0.1, 0.2, 0.3])
    worker = worker(connection:, input:, embedding_client:)

    assert_equal 2, worker.run_once
    assert_equal [["kind: event", "kind: event"]], embedding_client.embed_many_requests
    assert connection.statements.any? { |sql| sql.include?("last_cursor") && sql.include?("batch:10-11") }
    assert connection.statements.any? { |sql| sql.include?("rows_processed") && sql.include?("job:10") }
    assert connection.statements.any? { |sql| sql.include?("rows_processed") && sql.include?("job:11") }
  end

  test "rejects embeddings with unexpected dimensions" do
    job = {
      "job_id" => 8,
      "source_table" => "sync_scan_ingest",
      "source_key" => "event-2",
      "embedding_model" => "nomic-embed-text-v2-moe",
      "embedding_kind" => "event"
    }
    connection = FakeConnection.new([job])
    input = FakeInput.new(text: "kind: event", metadata: {})
    worker = worker(connection:, input:, vector: [0.1, 0.2])

    assert_equal 1, worker.run_once
    assert connection.statements.none? { |sql| sql.include?("INSERT INTO vec_embeddings") }
    assert connection.statements.any? { |sql| sql.include?("dimension mismatch") && sql.include?("status = CASE") }
  end

  test "does not crash when failure state update is locked" do
    job = {
      "job_id" => 9,
      "source_table" => "sync_scan_ingest",
      "source_key" => "event-3",
      "embedding_model" => "nomic-embed-text-v2-moe",
      "embedding_kind" => "event"
    }
    connection = FakeConnection.new([job], raise_on_failure_update: true)
    input = FakeInput.new(text: "kind: event", metadata: {})
    worker = worker(connection:, input:, vector: [0.1, 0.2])

    assert_equal 1, worker.run_once
    assert connection.statements.any? { |sql| sql.include?("status = CASE") }
  end

  private

  def worker(connection:, input:, vector: nil, embedding_client: nil)
    config = VectorEmbeddings::Config.new(
      enabled: true,
      provider: "ollama",
      url: "http://127.0.0.1:11434",
      model: "nomic-embed-text-v2-moe",
      dimensions: 3,
      batch_size: 2,
      request_batch_size: 2,
      lease_seconds: 1800,
      worker_name: "test-worker"
    )
    VectorEmbeddings::Worker.new(
      config:,
      connection:,
      embedding_client: embedding_client || FakeEmbeddingClient.new(vector),
      text_builder: FakeTextBuilder.new(input),
      logger: Logger.new(nil)
    )
  end
end
