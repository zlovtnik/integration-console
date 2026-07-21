# Integration Console

Rails management interface for the wireless sensor sync plane.

## Runtime configuration

- `DATABASE_URL` is a required `mysql2://` URL for the `integration_console` TiDB database.
- `SYNC_DATABASE_URL` is a separate required `mysql2://` URL selecting `octopus_core`. Its Rails account receives only explicit read grants on approved core and `atheros_search` projections. There is no URL fallback between these connections.
- Production TiDB URLs must use a non-root least-privilege Rails account and `ssl_mode=VERIFY_IDENTITY`; one Rails identity may be used for both database URLs.
- `SYNC_DB_POOL` controls the read-side TiDB connection pool. It defaults to `RAILS_MAX_THREADS` or `5`.
- `STATEMENT_TIMEOUT_MS` controls the TiDB session maximum statement execution time. It defaults to `8000`.
- `REDIS_URL` is required for the non-authoritative cache and ActionCable fan-out. Redis loss degrades cache/cable health but does not lose commands, runs, or configuration.
- `ACTION_CABLE_CHANNEL_PREFIX` must match the prefix used by the Octopus Redis fan-out processor.
- `SYNC_REDPANDA_BOOTSTRAP_SERVERS` points at Redpanda for read-only health and the remaining publishing compatibility paths.
- `SYNC_SCAN_CONSUMER`, `SYNC_LOAD_CONSUMER`, and `SYNC_RESULT_CONSUMER` identify the new versioned Octopus consumer groups shown by health checks.
- `INTEGRATION_CONSOLE_SCHEMA_VERSION` / `INTEGRATION_CONSOLE_SCHEMA_CHECKSUM`, `OCTOPUS_CORE_SCHEMA_VERSION` / `OCTOPUS_CORE_SCHEMA_CHECKSUM`, and `ATHEROS_SEARCH_SCHEMA_VERSION` / `ATHEROS_SEARCH_SCHEMA_CHECKSUM` pin the externally applied canonical manifests.
- `INTEGRATION_CONSOLE_CACHE_TTL_INVENTORY` controls inventory JSON fragment cache TTL. Defaults to `60` seconds.
- `INTEGRATION_CONSOLE_CACHE_TTL_AUDIT_RECENT` controls recent audit JSON cache TTL. Defaults to `10` seconds.
- `INTEGRATION_CONSOLE_CACHE_TTL_DASHBOARD` controls dashboard card cache TTL. Defaults to `15` seconds.
- `INTEGRATION_CONSOLE_FULL_MACS=true` allows full MAC display in audit logs; otherwise MACs are masked.
- `MINIO_ENDPOINT` points at the S3-compatible export cache. In Compose this defaults to `http://minio:9000`.
- `MINIO_ACCESS_KEY_ID` and `MINIO_SECRET_ACCESS_KEY` authenticate to MinIO.
- `MINIO_BUCKET` stores cached CSV exports. Defaults to `integration-console-exports`.
- `ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY`, `ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY`,
  and `ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT` configure Rails encrypted
  attributes. Development and test use deterministic local defaults when these are
  unset; production-like environments must set all three explicitly.
- Compose development stacks must set `ADMIN_API_KEY` explicitly before starting admin endpoints.

The root Compose stack includes a MinIO service and one-shot `minio-init`
container that creates `MINIO_BUCKET`. Cached export objects are cleaned up by
the Rails app when export requests run; objects older than 1 hour are deleted.

## Commands

```sh
bundle install
bun install
bin/schema-readiness
bun run build
bin/rails test
bin/rails server
```

For frontend HMR during development, run the Rails server and Vite server in
separate terminals:

```sh
bin/rails server
bun run dev
```

Or run both with a Procfile runner:

```sh
bin/dev
```

Do not run `db:prepare` against the runtime databases. The canonical schemas are
applied from the parent repository's `sql/tidb/` manifests by the dedicated DDL
job. Rails only checks the pinned schema ledger with `bin/schema-readiness`.

The former Rails Redpanda subscriber, wireless worker, heartbeat loop, and
heatmap refresh loop are retired startup paths. Octopus owns those processors
and the heatmap is now a physical, incrementally maintained projection table.
