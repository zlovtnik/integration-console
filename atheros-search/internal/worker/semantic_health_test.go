package worker

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type stubSemanticStatus struct {
	query  SemanticHealth
	worker SemanticHealth
}

func (s stubSemanticStatus) QuerySemantic() SemanticHealth  { return s.query }
func (s stubSemanticStatus) WorkerSemantic() SemanticHealth { return s.worker }

func TestWirelessProjection(t *testing.T) {
	now := time.Now()
	for _, test := range []struct {
		name string
		seen *time.Time
		want string
	}{
		{name: "never observed", seen: nil, want: "unknown"},
		{name: "fresh", seen: timePtr(now.Add(-5 * time.Minute)), want: "fresh"},
		{name: "stale", seen: timePtr(now.Add(-time.Hour)), want: "stale"},
		{name: "critical", seen: timePtr(now.Add(-3 * time.Hour)), want: "critical"},
	} {
		t.Run(test.name, func(t *testing.T) {
			require.Equal(t, test.want, wirelessProjection(test.seen))
		})
	}
}

func TestSnapshotMergesLiveSemanticHealthOverCachedData(t *testing.T) {
	monitor := NewHealthMonitor(nil)
	observed := time.Now().UTC().Add(-time.Minute)
	monitor.cached = &ETLHealth{MeasuredAt: time.Now().UTC(), WirelessLastObservedAt: &observed}
	monitor.SetSemanticStatus(stubSemanticStatus{
		query: SemanticHealth{
			PreflightState:   "compatible",
			CircuitState:     "closed",
			BackendAvailable: true,
		},
		worker: SemanticHealth{
			PreflightState:   "compatible",
			CircuitState:     "open",
			BackendAvailable: false,
		},
	})

	health, err := monitor.Snapshot(context.Background())
	require.NoError(t, err)
	require.Equal(t, "fresh", health.WirelessProjection)
	require.Equal(t, "compatible", health.QuerySemantic.PreflightState)
	require.True(t, health.QuerySemantic.BackendAvailable)
	require.Equal(t, "open", health.WorkerSemantic.CircuitState)
	require.False(t, health.WorkerSemantic.BackendAvailable)
}

func TestSnapshotReportsUnknownProjectionWithoutObservations(t *testing.T) {
	monitor := NewHealthMonitor(nil)
	monitor.cached = &ETLHealth{MeasuredAt: time.Now().UTC()}

	health, err := monitor.Snapshot(context.Background())
	require.NoError(t, err)
	require.Equal(t, "unknown", health.WirelessProjection)
}

func TestSnapshotObserverRunsAfterEachRefresh(t *testing.T) {
	monitor, mock := newHealthMonitor(t)
	rows := liveHealthRows()
	expectSnapshotQueries(mock, rows)

	var seen []ETLHealth
	monitor.SetSnapshotObserver(func(snapshot ETLHealth) {
		seen = append(seen, snapshot)
	})

	_, err := monitor.Snapshot(context.Background())
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
	require.Len(t, seen, 1)
	require.Equal(t, rows.embedPending, seen[0].EmbeddingPending)
	require.Len(t, seen[0].Workers, len(rows.workers))
}

func timePtr(value time.Time) *time.Time {
	return &value
}
