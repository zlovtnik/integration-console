class CreateRedpandaTrafficSamples < ActiveRecord::Migration[7.2]
  def change
    create_table :redpanda_traffic_samples do |t|
      t.string :topic, null: false
      t.string :sensor_id
      t.datetime :sampled_at, null: false
      t.integer :event_count, null: false, default: 0

      t.timestamps
    end

    add_index :redpanda_traffic_samples, [:topic, :sensor_id, :sampled_at], unique: true, name: "idx_redpanda_samples_topic_sensor_time"
    add_index :redpanda_traffic_samples, :sampled_at
  end
end
