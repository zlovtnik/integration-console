class AuditWindowPublisher
  TOPIC = "wireless.audit.config"

  def initialize(audit_window, publisher: Redpanda::Publisher.new)
    @audit_window = audit_window
    @publisher = publisher
  end

  def call
    @publisher.publish(TOPIC, @audit_window.payload)
  end
end
