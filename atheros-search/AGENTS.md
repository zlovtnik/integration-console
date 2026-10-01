# Atheros Search agent instructions

This subtree retains the Go module
`github.com/zlovtnik/ssl-proxy/services/atheros-search` and inherits the parent
repository architecture rules. Follow [maintenance rules](docs/quality.md),
[package ownership](docs/package-map.md), and [contracts](docs/contracts.md).

- Entrypoints call internal/app; HTTP and gRPC transports consume small feature
  interfaces. Feature services own their SQL and transactions.
- Reporting cannot import Search. Shared leaf packages cannot import features
  or transports. Verify these boundaries with `make boundaries`.
- Search streaming emits protobuf-JSON result lines followed by a done marker
  with response metadata. ETL streaming uses WebSocket JSON text frames.
- Saved-view owner identity is the immutable JWT subject; static tokens do not
  supply an end-user owner. Responses and logs never expose that subject.
- Keep diagnostic query/source/session/MAC values hashed or summarized.
- PostgreSQL configuration accepts only ATHSEARCH_POSTGRES_* variables, with no
  DATABASE_URL or SYNC_DATABASE_URL fallback. ATHSEARCH_STACK_ROOT is test-only.
- Workers remain opt-in through ATHSEARCH_WORKER_ENABLED=true. Keep token/fence
  checks in every lease mutation and atomic vector completion.
- Operational embedding repair lives in app/repair; health aggregation lives
  in etlhealth. Do not combine their query lifecycles.

Run `make quality-go` for standalone Go checks, `make fixtures` for shared UI
fixtures, and `make ui-check` for UI tests/build. Canonical checks require an
absolute ATHSEARCH_STACK_ROOT: `make stack-contract` and `make db-contract`.
Required database checks must execute without skips.

Use `make proto` only after proto source changes and `make proto-check` for
comparison. Tool pins and parent Make wrappers are documented in quality.md.
Repair CLI operations are documented in [scripts/README.md](scripts/README.md).
