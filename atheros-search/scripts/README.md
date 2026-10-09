# Atheros Search operational commands

Repository-level build and test entry points:

```bash
make atheros-search-proto
make atheros-search-build
make atheros-search-test
```

Embedding-job repair is implemented by `cmd/embedding-job-repair`:

```bash
go run ./cmd/embedding-job-repair -action=status
go run ./cmd/embedding-job-repair -action=reset-stale -stale-minutes=60
go run ./cmd/embedding-job-repair -action=retry-failed
go run ./cmd/embedding-job-repair -action=cancel-superseded -dry-run
go run ./cmd/embedding-job-repair -action=cancel-superseded -limit=5000
go run ./cmd/embedding-job-repair -action=cancel-orphaned -dry-run
go run ./cmd/embedding-job-repair -action=cancel-orphaned -limit=5000
```

- `cancel-superseded` cancels pending/leased jobs whose document is not
  `active` (superseded, deleted, or failed).
- `cancel-orphaned` cancels pending/leased jobs whose `search_documents` row is
  missing.
- `cancelled` is terminal: `retry-failed` will not reset it. Restoring a
  document requires a new job from Octopus `embedding-preparer`.

Run repair commands with the same Postgres DSN, CA and server-name verification as
the service. Start with `status`, capture evidence and confirm the exact
affected jobs before a mutation. The canonical service behavior and worker
configuration are in the [Atheros Search README](../README.md).
