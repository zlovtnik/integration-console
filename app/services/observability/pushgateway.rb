require "net/http"
require "uri"

module Observability
  class Pushgateway
    class << self
      def push(job:, metrics:, grouping: {})
        url = ENV["PUSHGATEWAY_URL"].to_s
        return if url.empty?

        path = ["/metrics/job", escape_path(job)]
        grouping.each do |key, value|
          path << escape_path(key)
          path << escape_path(value)
        end

        uri = URI.join(url.end_with?("/") ? url : "#{url}/", path.join("/").sub(%r{\A/}, ""))
        request = Net::HTTP::Put.new(uri)
        request["Content-Type"] = "text/plain; version=0.0.4"
        request.body = metrics
        Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https", open_timeout: 2, read_timeout: 5) do |http|
          response = http.request(request)
          Rails.logger.warn("Pushgateway push failed for #{job}: HTTP #{response.code}") unless response.is_a?(Net::HTTPSuccess)
        end
      rescue => error
        Rails.logger.warn("Pushgateway push failed for #{job}: #{error.class} #{error.message}")
      end

      private

      def escape_path(value)
        URI.encode_www_form_component(value.to_s)
      end
    end
  end
end
