require "json"
require "rdkafka"

module Redpanda
  class Publisher
    def initialize(bootstrap_servers: ENV.fetch("SYNC_REDPANDA_BOOTSTRAP_SERVERS", "127.0.0.1:9092"), client: nil)
      @bootstrap_servers = bootstrap_servers
      @client = client
    end

    def publish(topic, payload)
      body = payload.is_a?(String) ? payload : JSON.generate(payload)
      with_client do |client|
        client.produce(topic: topic, payload: body).wait
      end
      topic
    end

    private

    def with_client
      return yield @client if @client

      client = Rdkafka::Config.new("bootstrap.servers" => @bootstrap_servers).producer
      yield client
    ensure
      client&.close if client&.respond_to?(:close) && !@client
    end
  end
end
