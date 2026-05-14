class RedpandaTrafficSample < ApplicationRecord
  after_commit { DashboardCache.expire! }

  validates :topic, presence: true
  validates :sampled_at, presence: true
  validates :event_count, numericality: { greater_than_or_equal_to: 0 }

  scope :recent, -> { where("sampled_at >= ?", 5.minutes.ago) }

  def self.increment!(topic:, sensor_id:, sampled_at: Time.current)
    timestamp = sampled_at.change(sec: 0)
    sample_sensor_id = sensor_id.presence || "unknown"
    now = Time.current

    upsert_all(
      [
        {
          topic: topic,
          sensor_id: sample_sensor_id,
          sampled_at: timestamp,
          event_count: 1,
          created_at: now,
          updated_at: now
        }
      ],
      unique_by: :idx_redpanda_samples_topic_sensor_time,
      on_duplicate: Arel.sql("event_count = redpanda_traffic_samples.event_count + 1, updated_at = EXCLUDED.updated_at")
    )

    find_by!(topic: topic, sensor_id: sample_sensor_id, sampled_at: timestamp)
  end
end
