package embed

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestCircuitOpensAfterConfiguredFailures(t *testing.T) {
	circuit := NewCircuit()
	circuit.FailureMax = 2
	circuit.BaseBackoff = 30 * time.Second
	circuit.MaxBackoff = time.Minute
	require.Equal(t, CircuitClosed, circuit.State())

	circuit.record(context.Background(), errors.New("dial tcp: connection refused"))
	require.Equal(t, CircuitClosed, circuit.State())
	circuit.record(context.Background(), errors.New("dial tcp: connection refused"))
	require.Equal(t, CircuitOpen, circuit.State())

	_, admitted, _ := circuit.admit()
	require.False(t, admitted)

	circuit.record(context.Background(), nil)
	require.Equal(t, CircuitClosed, circuit.State())
	require.Equal(t, 0, circuit.Snapshot().Failures)
}

func TestCircuitIgnoresFailuresThatAreNotTheBackendsFault(t *testing.T) {
	for name, err := range map[string]error{
		"oversized input":  fmt.Errorf("chunk too large: %w", ErrOversizedInput),
		"invalid request":  invalidRequest("body exceeds limit"),
		"circuit rejected": &BackendUnavailableError{Cause: ErrCircuitOpen},
		"generic":          errors.New("dial tcp: connection refused"),
	} {
		t.Run(name, func(t *testing.T) {
			require.Equal(t, name == "generic", IsCircuitFailure(context.Background(), err))
		})
	}

	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	require.False(t, IsCircuitFailure(canceled, errors.New("context canceled")))

	deadlineCtx, cancelDeadline := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancelDeadline()
	require.False(t, IsCircuitFailure(deadlineCtx, context.DeadlineExceeded))
	require.True(t, IsCircuitFailure(context.Background(), context.DeadlineExceeded))
}

func TestCircuitAllowsOneHalfOpenProbeAndGrowsBackoff(t *testing.T) {
	circuit := NewCircuit()
	circuit.FailureMax = 1
	circuit.BaseBackoff = 30 * time.Second
	circuit.MaxBackoff = time.Minute
	now := time.Unix(1_700_000_000, 0)
	circuit.now = func() time.Time { return now }

	circuit.record(context.Background(), errors.New("dial tcp: connection refused"))
	require.Equal(t, CircuitOpen, circuit.State())
	require.Equal(t, now.Add(30*time.Second), circuit.Snapshot().RetryAt)

	now = now.Add(30 * time.Second)
	retryAt, admitted, probe := circuit.admit()
	require.True(t, admitted)
	require.True(t, probe)
	require.True(t, retryAt.IsZero())

	_, admitted, _ = circuit.admit()
	require.False(t, admitted, "only one half-open probe may run at a time")

	circuit.record(context.Background(), errors.New("dial tcp: connection refused"))
	require.Equal(t, CircuitOpen, circuit.State())
	require.Equal(t, now.Add(time.Minute), circuit.Snapshot().RetryAt)

	now = now.Add(time.Minute)
	_, admitted, probe = circuit.admit()
	require.True(t, admitted)
	require.True(t, probe)
	circuit.record(context.Background(), nil)
	require.Equal(t, CircuitClosed, circuit.State())
	require.True(t, circuit.Snapshot().RetryAt.IsZero())

	circuit.record(context.Background(), errors.New("dial tcp: connection refused"))
	require.Equal(t, now.Add(30*time.Second), circuit.Snapshot().RetryAt, "a success resets the backoff ladder")
}

func TestCircuitReleasesHalfOpenProbeAfterNeutralOutcome(t *testing.T) {
	circuit := NewCircuit()
	circuit.FailureMax = 1
	circuit.BaseBackoff = 30 * time.Second
	now := time.Unix(1_700_000_000, 0)
	circuit.now = func() time.Time { return now }

	circuit.record(context.Background(), errors.New("dial tcp: connection refused"))
	require.Equal(t, CircuitOpen, circuit.State())

	now = now.Add(30 * time.Second)
	_, admitted, probe := circuit.admit()
	require.True(t, admitted)
	require.True(t, probe)

	require.True(t, circuit.record(context.Background(), invalidRequest("body exceeds limit")))
	circuit.releaseProbe()
	require.Equal(t, CircuitHalfOpen, circuit.State(), "a neutral outcome must not move the breaker")

	_, admitted, probe = circuit.admit()
	require.True(t, admitted, "a neutral outcome must hand the probe slot back")
	require.True(t, probe)

	// A real failure still reopens the breaker, and a success still closes it.
	require.False(t, circuit.record(context.Background(), errors.New("dial tcp: connection refused")))
	require.Equal(t, CircuitOpen, circuit.State())
	now = now.Add(60 * time.Second)
	_, admitted, probe = circuit.admit()
	require.True(t, admitted)
	require.True(t, probe)
	require.False(t, circuit.record(context.Background(), nil))
	require.Equal(t, CircuitClosed, circuit.State())
}

func TestCircuitReleaseProbeKeepsRecordedTransitions(t *testing.T) {
	circuit := NewCircuit()
	circuit.FailureMax = 1
	circuit.BaseBackoff = 30 * time.Second
	now := time.Unix(1_700_000_000, 0)
	circuit.now = func() time.Time { return now }

	circuit.record(context.Background(), errors.New("dial tcp: connection refused"))
	require.Equal(t, CircuitOpen, circuit.State())

	now = now.Add(30 * time.Second)
	_, admitted, probe := circuit.admit()
	require.True(t, admitted)
	require.True(t, probe)

	require.False(t, circuit.record(context.Background(), nil))
	circuit.releaseProbe()
	require.Equal(t, CircuitClosed, circuit.State(), "releasing after a success must not reopen the breaker")

	require.False(t, circuit.record(context.Background(), errors.New("dial tcp: connection refused")))
	circuit.releaseProbe()
	require.Equal(t, CircuitOpen, circuit.State(), "releasing after a failure must not close the breaker")
	require.Equal(t, now.Add(30*time.Second), circuit.Snapshot().RetryAt)
}

func TestLanedClientRecoversAfterNeutralHalfOpenProbe(t *testing.T) {
	inner := &scriptedClient{err: errors.New("dial tcp: connection refused")}
	client := NewLaneClient(inner, LaneInteractive)
	client.Circuit.FailureMax = 1
	client.Circuit.BaseBackoff = 30 * time.Second
	now := time.Unix(1_700_000_000, 0)
	client.Circuit.now = func() time.Time { return now }

	require.Error(t, client.Health(context.Background()))
	require.Equal(t, CircuitOpen, client.State())
	require.ErrorIs(t, client.Health(context.Background()), ErrCircuitOpen)

	now = now.Add(30 * time.Second)
	inner.err = invalidRequest("body exceeds limit")
	for i := 0; i < 3; i++ {
		err := client.Health(context.Background())
		require.Error(t, err)
		require.NotErrorIs(t, err, ErrCircuitOpen, "a neutral outcome must not wedge the lane half-open")
		require.Equal(t, CircuitHalfOpen, client.State())
	}

	inner.err = nil
	require.NoError(t, client.Health(context.Background()))
	require.Equal(t, CircuitClosed, client.State())
}

type scriptedClient struct{ err error }

func (c *scriptedClient) Embed(context.Context, []string, Kind) ([][]float32, error) {
	return nil, c.err
}

func (c *scriptedClient) Health(context.Context) error { return c.err }

func TestCircuitSnapshotTracksLastCheckAndSuccess(t *testing.T) {
	circuit := NewCircuit()
	base := time.Unix(1_700_000_000, 0)
	now := base
	circuit.now = func() time.Time { return now }

	require.True(t, circuit.Snapshot().LastCheckAt.IsZero())
	circuit.markCheck()
	require.Equal(t, base, circuit.Snapshot().LastCheckAt)

	now = base.Add(5 * time.Second)
	circuit.record(context.Background(), nil)
	snapshot := circuit.Snapshot()
	require.Equal(t, now, snapshot.LastCheckAt)
	require.Equal(t, now, snapshot.LastSuccessAt)
	require.True(t, snapshot.LastFailureAt.IsZero())
}

func TestLanedClientKeepsLaneCircuitsIndependent(t *testing.T) {
	lanes := NewLanedClient(failingClient{})
	lanes.Worker.Circuit.FailureMax = 1
	lanes.Interactive.Circuit.FailureMax = 1

	_, err := lanes.Embed(WithLane(context.Background(), LaneWorker), []string{"a"}, KindEvent)
	require.Error(t, err)
	require.Equal(t, CircuitOpen, lanes.Worker.State())
	require.Equal(t, CircuitClosed, lanes.Interactive.State())

	_, err = lanes.Embed(context.Background(), []string{"a"}, KindEvent)
	require.Error(t, err)
	require.NotErrorIs(t, err, ErrCircuitOpen, "a bulk backlog must not block interactive queries")
	require.Equal(t, CircuitOpen, lanes.Worker.State())
}

func TestLanedClientHealthUsesInteractiveLane(t *testing.T) {
	lanes := NewLanedClient(failingClient{})
	lanes.Interactive.Circuit.FailureMax = 1

	require.Error(t, lanes.Health(context.Background()))
	require.Error(t, lanes.Health(context.Background()))
	require.Equal(t, CircuitOpen, lanes.Interactive.State())
	require.Equal(t, CircuitClosed, lanes.Worker.State(), "readiness probes must not trip the worker breaker")
}
