# Contract inventory

Canonical stack paths below are relative to the ssl-proxy checkout selected by
the test-only `ATHSEARCH_STACK_ROOT`. Production configuration never reads this
variable. Generated protobuf code remains in its existing authoritative module.

| Interface | Authority; producer and consumer | Compatibility and verification |
| --- | --- | --- |
| Search / Solid UI | proto/atheros/search/v1/search.proto and transport responses; Search produces, sibling atheros-search-ui consumes | Field names, optional false/absent, UTC timestamps, fallback codes, report freshness and error bodies: make fixtures; make ui-check |
| HTTP / clients | internal/transport/httpapi routes; Search produces, UI and external clients consume | Existing routes/body limits/status mappings; one protobuf-JSON result per NDJSON line plus terminal done/meta; make test, stream_contract_test.go |
| Graph / Solid UI | internal/reporting/graph_types.go and sibling atheros-search-ui/src/api/types.ts | Closed node/edge payloads; optional presentation-only parent/depth/role and hierarchy metadata; hierarchy root filters and explicit truncation; reporting graph tests, make db-contract, make ui-check |
| gRPC / clients | proto/atheros/search/v1/search.proto; Search produces, generated clients consume | Preserve RPC names and field numbers; real in-memory unary/streamed client tests; make proto-check and make test |
| ETL / clients | internal/transport/httpapi/health_handlers.go; ETL health produces, Solid UI consumes | Actual WebSocket upgrade, origin/auth, JSON text snapshots every five seconds, disconnect cleanup; make test |
| Octopus / workers | sql/postgres/contracts/processors.json and canonical embedding_jobs/search_documents; Octopus prepares jobs, Search claims/completes | Event/device/behaviour/sequence kinds, document/model/checksum identity, exclusive ownership, fences, retries and recovery; make stack-contract; make db-contract |
| Search / PostgreSQL | sql/postgres/atheros_search/manifest.yaml, octopus_core/manifest.yaml and their grants/least_privilege.sql.tmpl; canonical provisioner produces schema, feature services consume | Checksums, readiness, VECTOR(768), executable report/record-context/worker queries, isolated runtime privileges and denied DDL/Octopus access; make db-contract |
| Search / embedding backend | internal/embed/client.go request/response implementation; configured backend produces vectors, Search/worker consume | model/input request, OpenAI data[].embedding and embeddings[] shapes, count/dimension/finite validation, malformed payloads, capacity and retry timing; go test ./internal/embed ./internal/search |
| Search / deployment | internal/config/config.go and stack cyber-stack/base/atheros resources/platform-config; deployment supplies ATHSEARCH_* inputs, app consumes | HTTP/gRPC/metrics ports, health routes, worker opt-in, schema checksum wiring; config/app unit tests and stackcontract source checks |

Shared synthetic fixtures live in `testdata/contracts`. The UI imports the exact
files used by Go producer tests. No production observations or identifiers are
included. `search.json` represents protobuf JSON and `errors.json` represents
HTTP error envelopes. Error text and response shapes remain stable; typed
validation failures now return HTTP 400 when they previously fell through to 500.

Entity cursors are opaque strings. Following the requested pagination correction,
new cursors encode kind/query and every ranked sort component (pin, authorized
or registered flag, last-seen time, ascending ID). Timestamp comparison preserves
descending NULLS FIRST behavior. Legacy ID-only cursors are rejected as invalid;
clients should restart entity pagination after upgrading. Ranking/annotations
can change between requests, so pagination is consistent for unchanged data,
without promising a cross-request database snapshot.

Standalone integration-console CI runs formatting, vet, race, lint, architecture,
protobuf comparison, fixtures, UI tests and build without canonical parent files.
Parent CI verifies its pinned integration-console revision independently of
delegated service tests. Search SQL, grants, shared processors, Octopus schema,
checker changes and relevant submodule bumps select that contract stage even
without a Search gitlink change.

The database runner is the parent's scripts/tests/test_atheros_reporting.py.
Required mode fails if Docker, Testcontainers, or database connectivity is
unavailable, if any selected test skips, or if a consumer package executes no
tests. Seed writes use the provisioning account; assertions query through
canonical runtime grants. No production DDL or grants are modified.
