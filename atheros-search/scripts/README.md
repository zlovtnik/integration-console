# Atheros Search operational commands

Proxy recovery uses bounded `proxy-status` and `proxy-reconcile` pages. Supply
`-source-kinds=proxy_event,proxy_blocked_host_window`, `-model`,
`-input-revision`, `-created-before` (a frozen RFC3339 cutoff), and `-limit`
(1 through 1000). Both default to inspection;
`proxy-reconcile` also requires `-apply` and `-campaign-id` to retry completed current-content jobs
whose two vector stores are missing or disagree. Capture the returned
`after_job_id` and pass it as `-after-job-id` for the next page. Receipts retain
the previous state, attempts and diagnostic. Applied campaigns resume from their
persisted cursor and reject changed scope. A fresh Octopus queue policy and
sufficient headroom are required before a repair can enqueue work. Legacy
reset/retry commands below accept `-limit` and only target active non-proxy
documents; they cannot bypass scoped proxy campaign receipts and queue budgets.

The Go worker recovers expired leases in its configured kind, model and input
revision scope. For a failed job with attempts remaining, review the private
diagnostic and confirm that the cause has been corrected. Use `proxy-status`
with the same scope plus `-reviewed-failed-job`, the exact `updated_at` as
`-reviewed-at`, and a positive measured `-queue-reserve`. Proceed only if
`reviewed_failure=1` and the current capacity sample permits recovery. Apply
with `proxy-reconcile -apply -campaign-id` and a unique campaign ID for the
reviewed job. The retry uses the lowest worker priority, preserves the attempt
budget, and keeps the requested queue reserve free at admission. A changed
timestamp, exhausted attempt budget, cancelled job, stale content, superseded
document, or missing document makes the job ineligible.

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
