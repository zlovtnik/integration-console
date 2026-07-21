class CreateNetworkClients < ActiveRecord::Migration[7.2]
  def up
    execute <<~SQL
      CREATE TABLE IF NOT EXISTS wireless_clients (
        ssid TEXT NOT NULL,
        client_mac TEXT NOT NULL,
        known_bssid TEXT,
        first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
        probe_count INTEGER NOT NULL DEFAULT 1,
        location_id TEXT,
        PRIMARY KEY (ssid, client_mac)
      )
    SQL

    execute "CREATE INDEX IF NOT EXISTS idx_wireless_clients_client_mac ON wireless_clients (client_mac)"
    execute "CREATE INDEX IF NOT EXISTS idx_wireless_clients_last_seen ON wireless_clients (last_seen DESC)"
    execute <<~SQL
      CREATE INDEX IF NOT EXISTS idx_wireless_clients_known_bssid
        ON wireless_clients (known_bssid)
        WHERE known_bssid IS NOT NULL
    SQL
  end

  def down
    drop_table :wireless_clients, if_exists: true
  end
end
