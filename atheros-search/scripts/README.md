# Atheros Search operational commands

These commands operate on embedding jobs and vectors; they do not provision
the database or canonical schema. Run root `make atheros-search-*` wrappers from
the parent ssl-proxy workspace and `go run` commands from `atheros-search/`.

Proxy recovery uses bounded `proxy-status` and `proxy-reconcile` pages. Supply
`-source-kinds=proxy_event,proxy_blocked_host_window`, `-model`,
`-input-revision`, `-created-before` (a frozen RFC3339 cutoff), and `-limit`
(1 through 1000). Both default to inspection;
`proxy-reconcile` also requires `-apply` and `-campaign-id` to retry completed current-content jobs
whose two vector stores are missing or disagree. Capture the returned
`after_job_id` and pass it as `-after-job-id` for the next page. Receipts retain
the previous state, attempts and diagnostic. Applied campaigns resume from their
persisted cursor and reject changed scope. A fresh Octopus queue policy and
sufficient headroom are required before a repair can enqueue work. Failed, cancelled, exhausted,
superseded and orphaned work is not revived by this operation. Legacy broad
reset/retry commands below are not the proxy recovery runbook.

Repository-level build and test entry points:

```bash
make atheros-search-proto-check
make atheros-search-build
make atheros-search-test
```

Use `make atheros-search-proto` to regenerate bindings only after changing the
source `.proto`. Pinned generator requirements are in the
[quality guide](../docs/quality.md).

Embedding-job repair is implemented by `cmd/embedding-job-repair`:

The CLI requires `ATHSEARCH_POSTGRES_DSN` and
`ATHSEARCH_SCHEMA_MANIFEST_SHA256` (or their `-dsn` and
`-schema-manifest-sha256` equivalents), including for status inspection. It does
not assemble a DSN from the service's discrete host/password variables. Supply
`ATHSEARCH_POSTGRES_TLS_CA_FILE` and `ATHSEARCH_POSTGRES_TLS_SERVER_NAME` for
verified TLS, plus the certificate/key pair when client certificates are used.
Use the same restricted runtime identity and canonical readiness checksum as
the service. Do not place credentials in shell history.

```bash
go run ./cmd/embedding-job-repair -action=status
```

The following commands change durable job state unless `-dry-run` is shown.
Broad retry/reset actions are separate from the bounded proxy campaign workflow:

```bash
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

Start with `status`, capture evidence and confirm the exact
affected jobs before a mutation. The canonical service behavior and worker
configuration are in the [Atheros Search README](../README.md).
