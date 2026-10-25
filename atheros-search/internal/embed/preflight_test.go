package embed

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestValidateTokenizerRejectsSameLengthCorruption(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/tokenize":
			var request tokenizeRequest
			require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
			tokens := []int{1, 2}
			if request.Content == "corrupted readiness" {
				tokens = []int{3, 4}
			}
			require.NoError(t, json.NewEncoder(w).Encode(tokenizeResponse{Tokens: tokens}))
		case "/detokenize":
			require.NoError(t, json.NewEncoder(w).Encode(detokenizeResponse{Content: "corrupted readiness"}))
		default:
			t.Errorf("unexpected preflight endpoint: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := NewHTTPClient(server.URL, "contract-model", 2, 512)
	preflight := NewPreflight(client.ValidateTokenizer)
	require.False(t, preflight.CheckNow(t.Context()))
	require.False(t, preflight.Ready())
	require.Equal(t, PreflightIncompatible, preflight.Snapshot().State)
}

func TestValidateTokenizerAcceptsExactRoundTrip(t *testing.T) {
	server := (&llamaFake{}).server()
	defer server.Close()
	client := NewHTTPClient(server.URL, "contract-model", 2, 512)
	preflight := NewPreflight(client.ValidateTokenizer)
	require.True(t, preflight.CheckNow(t.Context()))
	require.True(t, preflight.Ready())
	require.Equal(t, PreflightCompatible, preflight.Snapshot().State)
}

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
