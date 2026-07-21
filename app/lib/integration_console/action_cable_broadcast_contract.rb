module IntegrationConsole
  module ActionCableBroadcastContract
    STATIC_STREAMS = %w[live_audit sensor_health sensor_alerts].freeze
    INTEGRATION_RUN_STREAM = /\Aintegration_run:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/.freeze

    module_function

    def redis_channel(stream, prefix:)
      validate_stream!(stream)
      [prefix.to_s.presence, stream].compact.join(":")
    end

    def encode(message)
      ActiveSupport::JSON.encode(message)
    end

    def decode(payload)
      message = ActiveSupport::JSON.decode(payload)
      raise ArgumentError, "ActionCable payload must be a JSON object" unless message.is_a?(Hash)

      message
    rescue JSON::ParserError => error
      raise ArgumentError, "ActionCable payload is not valid JSON: #{error.message}"
    end

    def envelope(stream:, message:, prefix:)
      {
        redis_channel: redis_channel(stream, prefix:),
        payload: encode(message)
      }
    end

    def validate_stream!(stream)
      value = stream.to_s
      return value if STATIC_STREAMS.include?(value) || INTEGRATION_RUN_STREAM.match?(value)

      raise ArgumentError, "unsupported ActionCable stream"
    end
  end
end
