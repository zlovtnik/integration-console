package worker

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

type healthWorker struct {
	id       string
	kind     string
	seenAt   time.Time
	metadata interface{}
}

type healthRows struct {
	wireless24h  int64
	wirelessLast interface{}

	ingestPending    int64
	ingestProcessing int64
	ingestFailed     int64

	batchPending    int64
	batchProcessing int64
	batchCompleted  int64
	batchFailed     int64

	jobPending   int64
	jobRunning   int64
	jobOrphaned  int64
	jobCompleted int64
	jobFailed    int64

	backlogPending int64
	backlogFailed  int64

	embedPending   int64
	embedLeased    int64
	embedCompleted int64
	embedFailed    int64
	embedRetries   int64
	oldestEmbed    interface{}

	workers []healthWorker
}

func liveHealthRows() healthRows {
	now := time.Now().UTC()
	return healthRows{
		wireless24h:    3633205,
		wirelessLast:   now.Add(-90 * time.Second),
		jobPending:     5323888,
		jobOrphaned:    5310000,
		jobCompleted:   55282,
		jobFailed:      4145,
		embedPending:   738362,
		embedLeased:    25,
		embedCompleted: 1509366,
		oldestEmbed:    now.Add(-32 * time.Hour),
		workers: []healthWorker{{
			id:     "worker-1",
			kind:   "pool",
			seenAt: now.Add(-20 * time.Second),
		}},
	}
}

func expectSnapshotQueries(mock sqlmock.Sqlmock, rows healthRows) {
	mock.ExpectQuery(`(?s)atheros_search\.search_documents`).
		WillReturnRows(sqlmock.NewRows([]string{"count", "max"}).AddRow(rows.wireless24h, rows.wirelessLast))

	mock.ExpectQuery(`(?s)octopus_core\.sync_events`).
		WillReturnRows(sqlmock.NewRows([]string{"pending", "processing", "failed"}).
			AddRow(rows.ingestPending, rows.ingestProcessing, rows.ingestFailed))

	mock.ExpectQuery(`(?s)octopus_core\.sync_batches`).
		WillReturnRows(sqlmock.NewRows([]string{"pending", "processing", "completed", "failed"}).
			AddRow(rows.batchPending, rows.batchProcessing, rows.batchCompleted, rows.batchFailed))

	mock.ExpectQuery(`(?s)octopus_core\.sync_jobs`).
		WillReturnRows(sqlmock.NewRows([]string{"pending", "running", "orphaned"}).
			AddRow(rows.jobPending, rows.jobRunning, rows.jobOrphaned))

	mock.ExpectQuery(`(?s)octopus_core\.sync_jobs`).
		WillReturnRows(sqlmock.NewRows([]string{"completed", "failed"}).
			AddRow(rows.jobCompleted, rows.jobFailed))

	mock.ExpectQuery(`(?s)octopus_core\.sync_backlog`).
		WillReturnRows(sqlmock.NewRows([]string{"pending", "failed"}).
			AddRow(rows.backlogPending, rows.backlogFailed))

	mock.ExpectQuery(`(?s)atheros_search\.embedding_jobs`).
		WillReturnRows(sqlmock.NewRows([]string{
			"pending", "leased", "completed", "failed", "retries", "oldest",
		}).AddRow(
			rows.embedPending, rows.embedLeased, rows.embedCompleted,
			rows.embedFailed, rows.embedRetries, rows.oldestEmbed,
		))

	workerRows := sqlmock.NewRows([]string{"worker_id", "worker_type", "last_seen_at", "metadata"})
	for _, worker := range rows.workers {
		workerRows.AddRow(worker.id, worker.kind, worker.seenAt, worker.metadata)
	}
	mock.ExpectQuery(`(?s)atheros_search\.worker_heartbeat.*` +
		`WHERE last_seen_at >= CURRENT_TIMESTAMP - INTERVAL '5 minutes'`).
		WillReturnRows(workerRows)
}

func newHealthMonitor(t *testing.T) (*HealthMonitor, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	return NewHealthMonitor(db), mock
}

func TestSnapshotReadsRepointedGaugeSources(t *testing.T) {
	monitor, mock := newHealthMonitor(t)
	rows := liveHealthRows()
	rows.ingestFailed = 2
	rows.batchPending = 5323943
	rows.batchFailed = 4285
	rows.backlogFailed = 7
	expectSnapshotQueries(mock, rows)

	health, err := monitor.Snapshot(context.Background())
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())

	require.Equal(t, int64(3633205), health.WirelessEvents24h)
	require.NotNil(t, health.WirelessLastObservedAt)
	require.Equal(t, int64(2), health.IngestFailed)
	require.Zero(t, health.IngestPending)
	require.Zero(t, health.IngestProcessing)
	require.Equal(t, int64(5323943), health.BatchPending)
	require.Equal(t, int64(4285), health.BatchFailed)
	require.Equal(t, int64(5323888), health.JobStoredPending)
	require.Equal(t, health.JobStoredPending, health.JobEffectivePending)
	require.Equal(t, int64(5310000), health.JobOrphaned)
	require.Equal(t, int64(7), health.BacklogFailed)
	require.Equal(t, int64(738362), health.EmbeddingPending)
	require.Len(t, health.Workers, 1)
}

func TestSnapshotServesCachedResultWithinTTL(t *testing.T) {
	monitor, mock := newHealthMonitor(t)
	expectSnapshotQueries(mock, liveHealthRows())

	first, err := monitor.Snapshot(context.Background())
	require.NoError(t, err)

	second, err := monitor.Snapshot(context.Background())
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet(), "second call must not query PostgreSQL")
	require.Equal(t, first.MeasuredAt, second.MeasuredAt)
}

func TestSnapshotRefreshesAfterCacheTTL(t *testing.T) {
	monitor, mock := newHealthMonitor(t)
	monitor.cacheTTL = -time.Second

	stale := liveHealthRows()
	stale.embedPending = 11
	expectSnapshotQueries(mock, stale)

	fresh := liveHealthRows()
	fresh.embedPending = 22
	expectSnapshotQueries(mock, fresh)

	first, err := monitor.Snapshot(context.Background())
	require.NoError(t, err)
	require.Equal(t, int64(11), first.EmbeddingPending)

	// The expired cache is served immediately while the refresh runs.
	second, err := monitor.Snapshot(context.Background())
	require.NoError(t, err)
	require.Equal(t, int64(11), second.EmbeddingPending)

	waitForRefresh(t, monitor)

	monitor.mu.Lock()
	refreshed := *monitor.cached
	monitor.mu.Unlock()
	require.NoError(t, mock.ExpectationsWereMet())
	require.Equal(t, int64(22), refreshed.EmbeddingPending)
}

func waitForRefresh(t *testing.T, monitor *HealthMonitor) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		monitor.mu.Lock()
		refreshing := monitor.refreshing
		monitor.mu.Unlock()
		if !refreshing {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("health refresh did not finish")
}

func TestSnapshotReportsBacklogForAgedEmbeddingQueue(t *testing.T) {
	monitor, mock := newHealthMonitor(t)
	rows := liveHealthRows()
	rows.oldestEmbed = time.Now().UTC().Add(-2 * time.Hour)
	expectSnapshotQueries(mock, rows)

	health, err := monitor.Snapshot(context.Background())
	require.NoError(t, err)
	require.Equal(t, "backlog", health.EmbeddingDependency)
}

func TestSnapshotReportsWaitingForWorkerWithoutFreshHeartbeat(t *testing.T) {
	monitor, mock := newHealthMonitor(t)
	rows := liveHealthRows()
	rows.workers = nil
	expectSnapshotQueries(mock, rows)

	health, err := monitor.Snapshot(context.Background())
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
	require.Equal(t, "waiting_for_worker", health.EmbeddingDependency)
}

func TestSnapshotReportsBlockedOnFailedEmbeddingJobs(t *testing.T) {
	monitor, mock := newHealthMonitor(t)
	rows := liveHealthRows()
	rows.embedFailed = 3
	rows.workers = nil
	expectSnapshotQueries(mock, rows)

	health, err := monitor.Snapshot(context.Background())
	require.NoError(t, err)
	require.Equal(t, "blocked", health.EmbeddingDependency)
}

func TestSnapshotReportsWaitingForSourceWhenQueueIsEmpty(t *testing.T) {
	monitor, mock := newHealthMonitor(t)
	rows := liveHealthRows()
	rows.embedPending = 0
	rows.embedLeased = 0
	rows.embedCompleted = 0
	rows.oldestEmbed = nil
	expectSnapshotQueries(mock, rows)

	health, err := monitor.Snapshot(context.Background())
	require.NoError(t, err)
	require.Equal(t, "waiting_for_source", health.EmbeddingDependency)
}

func TestSnapshotReturnsRefreshFailureWhenNoCacheExists(t *testing.T) {
	monitor, mock := newHealthMonitor(t)
	boom := errors.New("relation is not accessible")
	mock.ExpectQuery(`(?s)atheros_search\.search_documents`).
		WillReturnError(boom)

	_, err := monitor.Snapshot(context.Background())
	require.ErrorIs(t, err, boom)
	require.NoError(t, mock.ExpectationsWereMet())
}
