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

    def initialize(jobs)
      @jobs = jobs
      @queries = []
      @statements = []
    end

    def exec_query(sql, _name = nil)
      @queries << sql
      FakeResult.new(sql.include?("vec_lease_embedding_jobs") ? @jobs : [])
    end

    def execute(sql)
      @statements << sql
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
    def initialize(vector)
      @vector = vector
    end

    def embed(_text)
      @vector
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
    assert connection.queries.any? { |sql| sql.include?("vec_lease_embedding_jobs(2, 'test-worker')") }
    assert connection.statements.any? { |sql| sql.include?("INSERT INTO vec_embeddings") && sql.include?("ON CONFLICT") }
    assert connection.statements.any? { |sql| sql.include?("UPDATE vec_embedding_jobs") && sql.include?("status = 'completed'") }
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

  private

  def worker(connection:, input:, vector:)
    config = VectorEmbeddings::Config.new(
      enabled: true,
      provider: "ollama",
      url: "http://127.0.0.1:11434",
      model: "nomic-embed-text-v2-moe",
      dimensions: 3,
      batch_size: 2,
      worker_name: "test-worker"
    )
    VectorEmbeddings::Worker.new(
      config:,
      connection:,
      embedding_client: FakeEmbeddingClient.new(vector),
      text_builder: FakeTextBuilder.new(input),
      logger: Logger.new(nil)
    )
  end
end
