require "json"
require "net/http"
require "uri"

module VectorEmbeddings
  class OllamaClient
    def initialize(base_url:, model:, open_timeout: 5, read_timeout: 60)
      @base_url = base_url
      @model = model
      @open_timeout = open_timeout
      @read_timeout = read_timeout
    end

    def embed(text)
      embed_many([text]).first
    end

    def embed_many(texts)
      return [] if texts.empty?

      response = post_embed(texts)
      body = JSON.parse(response.body)
      vectors = normalize_vectors(body)
      raise Error, "embedding response count mismatch: expected #{texts.length}, got #{vectors.length}" unless vectors.length == texts.length

      vectors.map { |vector| vector.map { |value| Float(value) } }
    rescue JSON::ParserError => e
      raise Error, "embedding response was not JSON: #{e.message}"
    end

    private

    Error = Class.new(StandardError)

    def post_embed(input)
      uri = URI.parse(@base_url)
      uri.path = "/api/embed"
      uri.query = nil

      request = Net::HTTP::Post.new(uri)
      request["Content-Type"] = "application/json"
      request.body = JSON.generate(model: @model, input:)

      response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https", open_timeout: @open_timeout, read_timeout: @read_timeout) do |http|
        http.request(request)
      end
      raise Error, "embedding request failed with HTTP #{response.code}: #{response.body}" unless response.is_a?(Net::HTTPSuccess)

      response
    end

    def normalize_vectors(body)
      vectors = body["embeddings"]
      if vectors.nil? && body["embedding"].is_a?(Array)
        embedding = body["embedding"]
        vectors = embedding.first.is_a?(Array) ? embedding : [embedding]
      end
      raise Error, "embedding response did not include vectors" unless vectors.is_a?(Array)
      return vectors if vectors.all? { |vector| vector.is_a?(Array) }

      raise Error, "embedding response did not include vectors"
    end
  end
end
