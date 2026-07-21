require_relative "../contract_test_helper"
require "ostruct"
require "securerandom"

class ConsoleCommand
  class << self
    attr_reader :records

    def reset!
      @records = []
    end

    def find_by(idempotency_key:)
      records.find { |record| record.idempotency_key == idempotency_key }
    end

    def find_by!(idempotency_key:)
      find_by(idempotency_key:) || raise("missing command")
    end

    def create!(attributes)
      record = OpenStruct.new(attributes.merge(command_id: SecureRandom.uuid))
      record.define_singleton_method(:attributes) { to_h.stringify_keys }
      records << record
      record
    end
  end

  reset!
end

class ConsoleCommandAcknowledgement
  class << self
    attr_accessor :acknowledgement

    def uncached
      yield
    end

    def find_by(command_id:)
      acknowledgement if acknowledgement&.command_id == command_id
    end
  end
end

require File.join(CONSOLE_ROOT, "app/services/console_command_dispatcher")

class ConsoleCommandDispatcherTest < Minitest::Test
  def setup
    ConsoleCommand.reset!
    ConsoleCommandAcknowledgement.acknowledgement = nil
  end

  def test_inserts_once_and_returns_success_acknowledgement
    dispatcher = build_dispatcher
    command = dispatcher.send(:find_or_create_command!)
    ConsoleCommandAcknowledgement.acknowledgement = OpenStruct.new(
      command_id: command.command_id,
      status: "succeeded",
      error_message: nil
    )

    assert_equal command.command_id, dispatcher.call.command_id
    assert_equal 1, ConsoleCommand.records.length
  end

  def test_same_idempotency_key_with_different_payload_is_rejected
    build_dispatcher.send(:find_or_create_command!)

    error = assert_raises(ConsoleCommandDispatcher::ConflictError) do
      build_dispatcher(payload: { mac_id: "aa:bb:cc:dd:ee:ff", display_name: "Different" }).send(:find_or_create_command!)
    end

    assert_includes error.message, "different command"
  end

  def test_times_out_without_an_acknowledgement
    now = 0.0
    dispatcher = build_dispatcher(
      timeout: 0.1,
      poll_interval: 0.05,
      clock: -> { now },
      sleeper: ->(seconds) { now += seconds }
    )

    assert_raises(ConsoleCommandDispatcher::TimeoutError) { dispatcher.call }
    assert_equal 1, ConsoleCommand.records.length
  end

  private

  def build_dispatcher(payload: { mac_id: "aa:bb:cc:dd:ee:ff" }, **options)
    ConsoleCommandDispatcher.new(
      command_type: "device.upsert",
      aggregate_type: "device",
      aggregate_key: "aa:bb:cc:dd:ee:ff",
      payload:,
      idempotency_key: "request-1",
      requested_by: "rails:test",
      **options
    )
  end
end
