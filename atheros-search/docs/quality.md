# Atheros Search maintenance rules

Inherit repository architecture and GitOps rules from the parent AGENTS.md.
The service remains in integration-console with its existing Go module and
deployment identity. See [package ownership](package-map.md) and
[contract inventory](contracts.md) before changing a shared interface.

- Keep packages focused and dependencies acyclic. Do not introduce generic
  `utils`, `common`, or a repository-wide Go helper module. Transport-owned
  interfaces describe the feature methods each transport consumes.
- Features own parameterized SQL and explicit transaction boundaries. Propagate
  request cancellation and preserve isolation levels. Reporting cannot import
  Search; shared leaf packages cannot import features or transports.
- Use typed errors with `errors.Is`/`errors.As` for control flow. Check route
  registration, writes, persistence, and commit errors. Suppressed cleanup errors
  need a local comment explaining why they are best effort.
- Preserve hashed diagnostics, immutable saved-view subject ownership, fenced
  worker updates, schema readiness, and worker opt-in defaults.
- Add regression tests before changing shared logic. Consolidate helpers only
  when at least two production callers require equivalent semantics. Document
  intentional similarities in the package map.
- Contract changes require producer and consumer tests plus an updated contract
  inventory. Protobuf files change only through their pinned generator.

Required standalone checks are `make quality-go` and `make ui-check`. Install
tools with `make tools` and provide protoc 25.1. CI uses Go 1.26 and
golangci-lint 2.13.2, including govet, staticcheck, unused, ineffassign, errcheck,
bodyclose, gosec, and depguard. `tests/architecture` enforces additional package
boundaries. There are no broad lint exclusions; SQL suppressions describe fixed
fragments and bound parameters at the call site.

`make quality-go` checks formatting (including tagged tests), vet, race tests,
lint in ordinary and contract configurations, package boundaries, protobuf
regeneration comparison, and shared Go fixtures. `make fixtures` also checks
the Solid UI consumer; `make ui-check` runs its complete tests and production
build. Parent Make wrappers use the `atheros-search-` prefix.

Required stack checks use a canonical checkout:

```sh
make stack-contract ATHSEARCH_STACK_ROOT=/absolute/path/to/ssl-proxy
make db-contract ATHSEARCH_STACK_ROOT=/absolute/path/to/ssl-proxy
```

The database command requires Docker and the parent's test requirements. It
provisions an isolated pgvector PostgreSQL instance, applies canonical manifests
and grant templates, seeds through a provisioning account, and runs each
consumer through a runtime account. Missing dependencies and skipped tests fail
the required command. Ordinary unit tests need no parent checkout or database.

Run `make duplication-report` for review. Similar text is a review signal, not
proof of equivalent behavior. Do not make duplicate-block counts a merge gate.
