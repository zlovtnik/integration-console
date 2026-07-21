require "digest"

class ConsoleCommandDispatcher
  class Error < StandardError; end
  class ConflictError < Error; end
  class ProjectionUnavailableError < Error; end
  class RejectedError < Error; end
  class TimeoutError < Error; end

  SUCCESS_STATUS = "succeeded"
  FAILURE_STATUSES = %w[rejected failed].freeze

  def initialize(
    command_type:,
    aggregate_type:,
    aggregate_key:,
    payload:,
    idempotency_key:,
    requested_by:,
    timeout: ENV.fetch("CONSOLE_COMMAND_ACK_TIMEOUT_SECONDS", "3").to_f,
    poll_interval: ENV.fetch("CONSOLE_COMMAND_ACK_POLL_INTERVAL_SECONDS", "0.05").to_f,
    clock: -> { Process.clock_gettime(Process::CLOCK_MONOTONIC) },
    sleeper: ->(seconds) { sleep(seconds) }
  )
    @attributes = {
      command_type:,
      aggregate_type:,
      aggregate_key:,
      payload: payload.to_h.deep_stringify_keys,
      idempotency_key: normalized_idempotency_key(idempotency_key),
      requested_by:
    }
    @timeout = timeout.positive? ? timeout : 3.0
    @poll_interval = poll_interval.positive? ? poll_interval : 0.05
    @clock = clock
    @sleeper = sleeper
  end

  def call
    command = find_or_create_command!
    acknowledgement = wait_for_acknowledgement(command)
    return acknowledgement if acknowledgement.status == SUCCESS_STATUS

    if FAILURE_STATUSES.include?(acknowledgement.status)
      message = acknowledgement.error_message.presence || "Command was #{acknowledgement.status}"
      raise RejectedError, message
    end

    raise RejectedError, "Unsupported acknowledgement status #{acknowledgement.status.inspect}"
  end

  private

  attr_reader :attributes, :timeout, :poll_interval, :clock, :sleeper

  def find_or_create_command!
    command = ConsoleCommand.find_by(idempotency_key: attributes.fetch(:idempotency_key))
    return validate_existing!(command) if command

    ConsoleCommand.create!(attributes)
  rescue ActiveRecord::RecordNotUnique
    validate_existing!(ConsoleCommand.find_by!(idempotency_key: attributes.fetch(:idempotency_key)))
  end

  def validate_existing!(command)
    comparable = attributes.slice(:command_type, :aggregate_type, :aggregate_key, :payload)
    existing = command.attributes.symbolize_keys.slice(*comparable.keys)
    existing[:payload] = existing.fetch(:payload).to_h.deep_stringify_keys
    return command if existing == comparable

    raise ConflictError, "Idempotency key has already been used for a different command"
  end

  def wait_for_acknowledgement(command)
    deadline = clock.call + timeout
    loop do
      acknowledgement = ConsoleCommandAcknowledgement.uncached do
        ConsoleCommandAcknowledgement.find_by(command_id: command.command_id)
      end
      return acknowledgement if acknowledgement
      break if clock.call >= deadline

      sleeper.call(poll_interval)
    end

    raise TimeoutError, "Command acknowledgement timed out"
  end

  def normalized_idempotency_key(value)
    text = value.to_s
    raise ArgumentError, "idempotency key is required" if text.empty?

    "sha256:#{Digest::SHA256.hexdigest(text)}"
  end
end
