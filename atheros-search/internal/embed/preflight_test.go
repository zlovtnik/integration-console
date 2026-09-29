package embed

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestPreflightHoldsWorkersUntilTokenizerIsProven(t *testing.T) {
	backendHealthy := false
	preflight := NewPreflight(func(context.Context) error {
		if !backendHealthy {
			return errors.New("tokenizer round trip mismatched")
		}
		return nil
	})
	preflight.checkInterval = time.Millisecond
	preflight.maxInterval = time.Millisecond
	preflight.successEvery = time.Hour

	require.Equal(t, PreflightPending, preflight.Snapshot().State)
	require.False(t, preflight.Ready())

	require.False(t, preflight.CheckNow(context.Background()))
	require.Equal(t, PreflightIncompatible, preflight.Snapshot().State)
	require.False(t, preflight.Ready())
	require.False(t, preflight.Snapshot().LastCheckAt.IsZero())
	require.True(t, preflight.Snapshot().LastSuccessAt.IsZero())

	backendHealthy = true
	require.True(t, preflight.CheckNow(context.Background()))
	require.True(t, preflight.Ready())
	require.False(t, preflight.Snapshot().LastSuccessAt.IsZero())

	backendHealthy = false
	require.False(t, preflight.CheckNow(context.Background()))
	require.False(t, preflight.Ready(), "a later failure must close the gate again")
}

func TestPreflightDisabledWithoutConfiguredBackend(t *testing.T) {
	preflight := NewPreflight(nil)
	require.Equal(t, PreflightDisabled, preflight.Snapshot().State)
	require.False(t, preflight.Ready())

	done := make(chan struct{})
	go func() {
		preflight.Run(context.Background())
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Run must return immediately when no check is configured")
	}
}

func TestPreflightRunStopsOnContextCancellation(t *testing.T) {
	preflight := NewPreflight(func(context.Context) error { return nil })
	preflight.successEvery = time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		preflight.Run(ctx)
		close(done)
	}()
	require.Eventually(t, preflight.Ready, time.Second, time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Run must stop when the context is canceled")
	}
}

func TestPreflightNotifiesOnStateTransition(t *testing.T) {
	backendHealthy := false
	preflight := NewPreflight(func(context.Context) error {
		if !backendHealthy {
			return errors.New("no")
		}
		return nil
	})
	var seen []PreflightState
	preflight.SetTransitionObserver(func(state PreflightState) { seen = append(seen, state) })

	preflight.CheckNow(context.Background())
	preflight.CheckNow(context.Background())
	backendHealthy = true
	preflight.CheckNow(context.Background())
	preflight.CheckNow(context.Background())

	require.Equal(t, []PreflightState{PreflightIncompatible, PreflightCompatible}, seen)
}
