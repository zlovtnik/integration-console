package worker

import (
	"context"
	"database/sql"
	"encoding/json"
	"sync"
	"time"
)

const (
	// snapshotCacheTTL is how long a computed snapshot is served before a
	// background refresh runs. The health queries count multi-million row
	// queue tables (seconds of database time per refresh) and four HTTP
	// surfaces plus the 5s ETL stream all share one Snapshot.
	snapshotCacheTTL = 30 * time.Second
	// workerHeartbeatFresh is the age past which a worker_heartbeat row no
	// longer counts as a live worker. Workers write every max(10s, poll*10).
	workerHeartbeatFresh = 5 * time.Minute
	// embeddingBacklogAge is how old the oldest open embedding job may be
	// before embedding_dependency reports backlog instead of healthy.
	embeddingBacklogAge = time.Hour
	// jobStaleAge is the queued-work window behind job_orphaned: pending or
	// running jobs older than this are counted as orphaned.
	jobStaleAge = 5 * time.Minute
)

type ETLHealth struct {
	MeasuredAt             time.Time         `json:"measured_at"`
	WirelessEvents24h      int64             `json:"wireless_events_24h"`
	WirelessLastObservedAt *time.Time        `json:"wireless_last_observed_at,omitempty"`
	IngestPending          int64             `json:"ingest_pending"`
	IngestProcessing       int64             `json:"ingest_processing"`
	IngestFailed           int64             `json:"ingest_failed"`
	BatchPending           int64             `json:"batch_pending"`
	BatchProcessing        int64             `json:"batch_processing"`
	BatchCompleted         int64             `json:"batch_completed"`
	BatchFailed            int64             `json:"batch_failed"`
	JobStoredPending       int64             `json:"job_stored_pending"`
	JobStoredRunning       int64             `json:"job_stored_running"`
	JobStoredCompleted     int64             `json:"job_stored_completed"`
	JobStoredFailed        int64             `json:"job_stored_failed"`
	JobEffectivePending    int64             `json:"job_effective_pending"`
	JobEffectiveRunning    int64             `json:"job_effective_running"`
	JobEffectiveCompleted  int64             `json:"job_effective_completed"`
	JobEffectiveFailed     int64             `json:"job_effective_failed"`
	JobOrphaned            int64             `json:"job_orphaned"`
	BacklogPending         int64             `json:"backlog_pending"`
	BacklogFailed          int64             `json:"backlog_failed"`
	EmbeddingPending       int64             `json:"embedding_pending"`
	EmbeddingLeased        int64             `json:"embedding_leased"`
	EmbeddingCompleted     int64             `json:"embedding_completed"`
	EmbeddingFailed        int64             `json:"embedding_failed"`
	EmbeddingRetryCount    int64             `json:"embedding_retry_count"`
	OldestEmbeddingJobAt   *time.Time        `json:"oldest_embedding_job_at,omitempty"`
	EmbeddingDependency    string            `json:"embedding_dependency"`
	Workers                []WorkerHeartbeat `json:"workers"`
}

type WorkerHeartbeat struct {
	WorkerID   string          `json:"worker_id"`
	WorkerType string          `json:"worker_type"`
	LastSeenAt time.Time       `json:"last_seen_at"`
	Metadata   json.RawMessage `json:"metadata,omitempty"`
}

type HealthMonitor struct {
	db     *sql.DB
	logger interface {
		Debug() interface{ Msg(string) }
	}

	mu          sync.Mutex
	cached      *ETLHealth
	lastErr     error
	refreshing  bool
	refreshDone chan struct{}
	cacheTTL    time.Duration
}

func NewHealthMonitor(db *sql.DB) *HealthMonitor {
	return &HealthMonitor{db: db, cacheTTL: snapshotCacheTTL}
}

// Warm primes the snapshot cache so the first HTTP caller does not pay for a
// full refresh. Failures are retried by Snapshot.
func (h *HealthMonitor) Warm(ctx context.Context) {
	_, _ = h.Snapshot(ctx)
}

// Snapshot returns the most recent health snapshot. Because the gauges count
// multi-million row queue tables, a refresh runs at most once per cacheTTL in
// the background: callers share one refresh, and every caller after the first
// is answered from the cache instead of waiting on PostgreSQL.
func (h *HealthMonitor) Snapshot(ctx context.Context) (ETLHealth, error) {
	for {
		h.mu.Lock()
		if h.cached != nil {
			health := *h.cached
			expired := time.Since(health.MeasuredAt) >= h.cacheTTL
			if expired && !h.refreshing {
				h.startRefreshLocked()
			}
			h.mu.Unlock()
			return health, nil
		}
		if h.refreshing {
			done := h.refreshDone
			h.mu.Unlock()
			select {
			case <-done:
				continue
			case <-ctx.Done():
				return ETLHealth{}, ctx.Err()
			}
		}
		h.startRefreshLocked()
		done := h.refreshDone
		h.mu.Unlock()
		select {
		case <-done:
			h.mu.Lock()
			err := h.lastErr
			h.mu.Unlock()
			if err != nil {
				return ETLHealth{}, err
			}
			continue
		case <-ctx.Done():
			return ETLHealth{}, ctx.Err()
		}
	}
}

// startRefreshLocked launches one background refresh. Callers must hold h.mu.
func (h *HealthMonitor) startRefreshLocked() {
	h.refreshing = true
	h.refreshDone = make(chan struct{})
	go h.refresh()
}

func (h *HealthMonitor) refresh() {
	health, err := h.snapshotFromDB(context.Background())
	h.mu.Lock()
	defer h.mu.Unlock()
	h.refreshing = false
	if err != nil {
		h.lastErr = err
	} else {
		h.cached = &health
		h.lastErr = nil
	}
	close(h.refreshDone)
}

// snapshotFromDB reads each gauge from the live table that owns it:
//   - wireless gauges from atheros_search.search_documents (the indexed feed)
//   - ingest gauges from octopus_core.sync_events (the ingest ledger)
//   - batch/job/backlog gauges from octopus_core.sync_batches, sync_jobs and
//     sync_backlog (the dispatch queue)
//   - embedding gauges from atheros_search.embedding_jobs
func (h *HealthMonitor) snapshotFromDB(ctx context.Context) (ETLHealth, error) {
	var health ETLHealth
	health.MeasuredAt = time.Now().UTC()

	// Both subqueries stay on the (source_kind, observed_at) index: the 24h
	// count is a bounded range scan and the max is a backward index scan.
	err := h.db.QueryRowContext(ctx, `
SELECT
  (SELECT COUNT(*)
     FROM atheros_search.search_documents
    WHERE source_kind = 'event'
      AND observed_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'),
  (SELECT MAX(observed_at)
     FROM atheros_search.search_documents
    WHERE source_kind = 'event')
`).Scan(
		&health.WirelessEvents24h,
		&health.WirelessLastObservedAt,
	)
	if err != nil {
		return health, err
	}

	// Ingest failures are the only live transition on this ledger: events are
	// inserted as 'batched', so pending/processing stay 0 unless the ingest
	// path stalls before batching or fails.
	err = h.db.QueryRowContext(ctx, `
SELECT
  COUNT(*) FILTER (WHERE status = 'pending'),
  COUNT(*) FILTER (WHERE status = 'processing'),
  COUNT(*) FILTER (WHERE status = 'failed')
FROM octopus_core.sync_events
WHERE status IN ('pending', 'processing', 'failed')
`).Scan(
		&health.IngestPending,
		&health.IngestProcessing,
		&health.IngestFailed,
	)
	if err != nil {
		return health, err
	}

	// The pending scan is separated so the planner keeps the selective
	// statuses on an index instead of falling back to a sequential scan.
	err = h.db.QueryRowContext(ctx, `
SELECT
  (SELECT COUNT(*) FROM octopus_core.sync_batches WHERE status = 'pending'),
  COUNT(*) FILTER (WHERE status IN ('processing', 'dispatched')),
  COUNT(*) FILTER (WHERE status = 'completed'),
  COUNT(*) FILTER (WHERE status = 'failed')
FROM octopus_core.sync_batches
WHERE status IN ('processing', 'dispatched', 'completed', 'failed')
`).Scan(
		&health.BatchPending,
		&health.BatchProcessing,
		&health.BatchCompleted,
		&health.BatchFailed,
	)
	if err != nil {
		return health, err
	}

	err = h.db.QueryRowContext(ctx, `
SELECT
  COUNT(*) FILTER (WHERE status = 'pending'),
  COUNT(*) FILTER (WHERE status = 'running'),
  COUNT(*) FILTER (WHERE status IN ('pending', 'running')
                   AND created_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes')
FROM octopus_core.sync_jobs
WHERE status IN ('pending', 'running')
`).Scan(
		&health.JobStoredPending,
		&health.JobStoredRunning,
		&health.JobOrphaned,
	)
	if err != nil {
		return health, err
	}

	err = h.db.QueryRowContext(ctx, `
SELECT
  COUNT(*) FILTER (WHERE status = 'completed'),
  COUNT(*) FILTER (WHERE status = 'failed')
FROM octopus_core.sync_jobs
WHERE status IN ('completed', 'failed')
`).Scan(
		&health.JobStoredCompleted,
		&health.JobStoredFailed,
	)
	if err != nil {
		return health, err
	}

	// The legacy effective status rolled each job up against its batches,
	// which needs a sync_batches.job_id index and a 10M-row join per refresh.
	// Batch-side state is reported through batch_* instead, so the effective
	// gauges mirror the stored ones and job_orphaned carries the staleness.
	health.JobEffectivePending = health.JobStoredPending
	health.JobEffectiveRunning = health.JobStoredRunning
	health.JobEffectiveCompleted = health.JobStoredCompleted
	health.JobEffectiveFailed = health.JobStoredFailed

	err = h.db.QueryRowContext(ctx, `
SELECT
  COUNT(*) FILTER (WHERE status = 'pending'),
  COUNT(*) FILTER (WHERE status = 'failed')
FROM octopus_core.sync_backlog
`).Scan(
		&health.BacklogPending,
		&health.BacklogFailed,
	)
	if err != nil {
		return health, err
	}

	embedErr := h.db.QueryRowContext(ctx, `
SELECT
  COUNT(*) FILTER (WHERE status = 'pending'),
  COUNT(*) FILTER (WHERE status = 'leased'),
  COUNT(*) FILTER (WHERE status = 'completed'),
  COUNT(*) FILTER (WHERE status = 'failed'),
  COALESCE(SUM(attempt_count) FILTER (WHERE status IN ('pending', 'leased', 'failed')), 0),
  MIN(created_at) FILTER (WHERE status IN ('pending', 'leased'))
FROM atheros_search.embedding_jobs
`).Scan(
		&health.EmbeddingPending,
		&health.EmbeddingLeased,
		&health.EmbeddingCompleted,
		&health.EmbeddingFailed,
		&health.EmbeddingRetryCount,
		&health.OldestEmbeddingJobAt,
	)
	if embedErr != nil && embedErr != sql.ErrNoRows {
		return health, embedErr
	}

	// A heartbeat read failure must not fail the snapshot: an empty worker
	// list then reports waiting_for_worker while pending work exists.
	rows, err := h.db.QueryContext(ctx, `
SELECT worker_id, worker_type, last_seen_at, metadata
FROM atheros_search.worker_heartbeat
WHERE last_seen_at >= CURRENT_TIMESTAMP - INTERVAL '5 minutes'
ORDER BY worker_id
`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var (
				wh       WorkerHeartbeat
				metadata sql.NullString
			)
			if err := rows.Scan(&wh.WorkerID, &wh.WorkerType, &wh.LastSeenAt, &metadata); err != nil {
				continue
			}
			// pool workers upsert a NULL metadata column; scanning it into
			// json.RawMessage fails and would drop the worker from the list.
			if metadata.Valid {
				wh.Metadata = json.RawMessage(metadata.String)
			}
			health.Workers = append(health.Workers, wh)
		}
	}

	health.EmbeddingDependency = embeddingDependency(health)
	return health, nil
}

// embeddingDependency ranks the loudest problem first: failed jobs block the
// pipeline, a missing worker explains an undrained queue, an aged queue is a
// backlog, and an idle source means there is nothing to do.
func embeddingDependency(health ETLHealth) string {
	switch {
	case health.EmbeddingFailed > 0:
		return "blocked"
	case health.EmbeddingPending > 0 && len(health.Workers) == 0:
		return "waiting_for_worker"
	case health.EmbeddingPending > 0 &&
		health.OldestEmbeddingJobAt != nil &&
		time.Since(*health.OldestEmbeddingJobAt) > embeddingBacklogAge:
		return "backlog"
	case health.EmbeddingPending == 0 && health.EmbeddingCompleted == 0:
		return "waiting_for_source"
	default:
		return "healthy"
	}
}
