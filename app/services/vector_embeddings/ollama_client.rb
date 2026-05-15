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
      response = post_embed(text)
      body = JSON.parse(response.body)
      vector = body["embeddings"]&.first || body["embedding"]
      raise Error, "embedding response did not include a vector" unless vector.is_a?(Array)

      vector.map { |value| Float(value) }
    rescue JSON::ParserError => e
      raise Error, "embedding response was not JSON: #{e.message}"
    end

    private

    Error = Class.new(StandardError)

    def post_embed(text)
      uri = URI.parse(@base_url)
      uri.path = "/api/embed"
      uri.query = nil

      request = Net::HTTP::Post.new(uri)
      request["Content-Type"] = "application/json"
      request.body = JSON.generate(model: @model, input: text)

      response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https", open_timeout: @open_timeout, read_timeout: @read_timeout) do |http|
        http.request(request)
      end
      raise Error, "embedding request failed with HTTP #{response.code}: #{response.body}" unless response.is_a?(Net::HTTPSuccess)

      response
    end
  end
end
