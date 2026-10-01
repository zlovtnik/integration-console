# Package ownership

Every handwritten package stays in this Go module. Tests live beside their
implementation; cross-stack source assertions have explicit build tags.

| Package | Responsibility and dependencies |
| --- | --- |
| cmd/server, cmd/embedding-job-repair | Thin entrypoints into app or app/repair |
| internal/app | Dependency construction, startup, shutdown, background tasks; may wire all services |
| internal/app/repair | Operational repair queries, separate from health aggregation |
| internal/transport/httpapi | Routes, parsing, auth, response encoding, NDJSON and WebSocket; feature interfaces, no SQL |
| internal/transport/grpcapi | gRPC registration, auth and typed error translation; consuming Search interface |
| internal/search | Dense/sparse retrieval, fusion, suggestions, explain, record context; may consume reporting evidence |
| internal/reporting | Graph, inventory, network, investigation and pairs; never imports Search |
| internal/assets | Entity choices, annotations, merge decisions; apperror and queryscope |
| internal/savedviews | Validation, persistence, subject ownership, revisions; reporting filter validation |
| internal/queryscope | Shared scoping, normalization and scan primitives; no features or transports |
| internal/reportmeta | Report metadata and protobuf conversion; no features or transports |
| internal/apperror | Typed validation, not-found, conflict, forbidden, unavailable errors; no features or transports |
| internal/etlhealth | Cached database health snapshots, deadlines and live semantic view |
| internal/worker | Fenced claims, renewal, recovery and atomic vector completion; embed dependency |
| internal/auth | Static token and JWT authorization |
| internal/config | Environment validation and defaults; embedding configuration |
| internal/db | Connection/TLS setup and canonical schema readiness |
| internal/embed | Backend requests, token budgets, batching, lane capacity and circuits |
| internal/health | Runtime readiness and schema startup gate |
| internal/metrics | Prometheus registration and metrics HTTP server |
| internal/observability | Tracing setup |
| internal/testdb | Test-only provisioning/runtime connections; mandatory DSNs, no skips |
| tests/architecture | Enforced handwritten package/import/SQL boundaries |
| tests/compatibility | Producer JSON checked against shared synthetic UI fixtures |
| tests/contracts | Canonical manifests and ownership assertions; stackcontract tag |

Reporting files separate types, normalization, queries and response assembly
where these responsibilities are large. Smaller coherent endpoint implementations
remain single files. Query and transaction ownership belongs to each feature.
Record context reuses reporting evidence assembly in the caller's existing
repeatable-read transaction.

Intentional similarities after duplication review:

- Dense and sparse queries share result scans and nullable/UTC normalization.
  Their scores, ordering, overfetch budgets and filtering remain distinct.
- Sparse wildcard and full-text queries use different predicates and score
  columns. Their SQL stays explicit.
- Explain and retrieval apply filters to different record/score lifecycles.
  They share equivalent scoping primitives without merging entire queries.
- Graph lists preserve case and sort for deterministic fingerprints. Query lists
  normalize case and preserve encounter order. These are separate operations.
- Search and search-stream logging describe different response lifecycles.
  Their body, authorization, and response helpers are shared.
- Worker mutations repeat token/fence guards because each atomic statement must
  independently reject stale ownership. Repair queries remain in app/repair.

`go test ./tests/architecture` enforces the allowed dependency map. Go's compiler
rejects cycles. See [maintenance rules](quality.md) for the full command set.
