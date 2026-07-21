class ConsoleCommand < ApplicationRecord
  self.primary_key = "command_id"

  STATUSES = %w[pending leased succeeded rejected failed cancelled].freeze
  COMMAND_TYPES = %w[
    device.upsert
    device.delete
    authorized_network.upsert
    authorized_network.delete
  ].freeze

  attribute :payload, :json, default: -> { {} }

  has_one :acknowledgement,
    class_name: "ConsoleCommandAcknowledgement",
    foreign_key: :command_id,
    inverse_of: :command

  before_validation :assign_defaults, on: :create

  validates :command_id, :command_type, :aggregate_type, :aggregate_key,
    :idempotency_key, :requested_by, :requested_at, :status, presence: true
  validates :command_type, inclusion: { in: COMMAND_TYPES }
  validates :status, inclusion: { in: STATUSES }
  validates :idempotency_key, length: { maximum: 128 }, uniqueness: true
  validates :attempt_count, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :max_attempts, numericality: { only_integer: true, greater_than: 0 }

  private

  def assign_defaults
    now = Time.current
    self.command_id ||= SecureRandom.uuid
    self.requested_at ||= now
    self.next_attempt_at ||= now
    self.status ||= "pending"
    self.attempt_count ||= 0
    self.max_attempts ||= ENV.fetch("CONSOLE_COMMAND_MAX_ATTEMPTS", "5").to_i.clamp(1, 100)
  end
end
