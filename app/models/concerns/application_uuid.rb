require "securerandom"

module ApplicationUuid
  extend ActiveSupport::Concern

  included do
    before_validation :assign_application_uuid, on: :create
  end

  private

  def assign_application_uuid
    self.id ||= SecureRandom.uuid
  end
end
