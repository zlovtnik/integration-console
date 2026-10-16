package dedup

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/apperror"
)

const runJSON = `{"run_id":"run-1","installation_id":"test","namespace":"audit","processor_id":"atheros.dedup","processor_version":"0.1.0","status":"queued","state_revision":1,"execution_mode":"shadow","projection_applied":false}`

func options(managerURL string) Options {
	return Options{Enabled: true, ManagerURL: managerURL, ServiceToken: "service-secret", InstallationID: "test", Namespace: "audit", Timeout: time.Second}
}

func invocation() Request {
	return Request{Operation: "prepare_candidates", AuthorizedScope: "location-1", PolicyVersion: "v1", MaxCandidates: 100, IdempotencyKey: "request-1"}
}

func TestAdmissionPinsDelegatedIdentityAndPreservesRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/v1/runs", r.URL.Path)
		require.Equal(t, "Bearer service-secret", r.Header.Get("Authorization"))
		var request map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
		require.Equal(t, "test", request["installation_id"])
		require.Equal(t, "audit", request["namespace"])
		require.Equal(t, "atheros.dedup", request["processor_id"])
		require.Equal(t, "request-1", request["idempotency_key"])
		require.NotContains(t, request, "execution_mode")
		require.Equal(t, "location-1", request["parameters"].(map[string]any)["authorized_scope"])
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(runJSON))
	}))
	t.Cleanup(server.Close)
	run, err := New(options(server.URL)).Admit(context.Background(), invocation())
	require.NoError(t, err)
	require.Equal(t, "queued", run.Status)
	require.False(t, run.ProjectionApplied)
}

func TestRunUsesScopedStatusRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/v1/runs/run-1", r.URL.Path)
		require.Equal(t, "test", r.URL.Query().Get("installation_id"))
		require.Equal(t, "audit", r.URL.Query().Get("namespace"))
		_, _ = w.Write([]byte(runJSON))
	}))
	t.Cleanup(server.Close)
	_, err := New(options(server.URL)).Run(context.Background(), "run-1")
	require.NoError(t, err)
}

func TestDisabledAndInvalidRequestsNeverReachManager(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		cfg := options("http://127.0.0.1:1")
		cfg.Enabled = enabled
		request := invocation()
		if enabled {
			request.MaxCandidates = 1001
		}
		_, err := New(cfg).Admit(context.Background(), request)
		kind := apperror.ErrForbidden
		if enabled {
			kind = apperror.ErrValidation
		}
		require.ErrorIs(t, err, kind)
	}
	_, err := New(options("http://127.0.0.1:1")).Run(context.Background(), "../outside")
	require.ErrorIs(t, err, apperror.ErrValidation)
}

func TestManagerErrorsAreTypedAndSanitized(t *testing.T) {
	for status, kind := range map[int]error{400: apperror.ErrValidation, 401: apperror.ErrForbidden, 403: apperror.ErrForbidden, 404: apperror.ErrNotFound, 409: apperror.ErrConflict, 429: apperror.ErrCapacity, 503: apperror.ErrUnavailable} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(status)
				_, _ = w.Write([]byte(`{"error":"sensitive upstream detail"}`))
			}))
			t.Cleanup(server.Close)
			_, err := New(options(server.URL)).Run(context.Background(), "run-1")
			require.ErrorIs(t, err, kind)
			require.NotContains(t, err.Error(), "sensitive")
		})
	}
}

func TestStatusRejectsOversizedMalformedAndCrossScopeResponses(t *testing.T) {
	for _, body := range []string{strings.Repeat("x", maxControlBytes+1), `{}`, strings.Replace(runJSON, `"audit"`, `"outside"`, 1), strings.Replace(runJSON, `"atheros.dedup"`, `"other"`, 1), strings.Replace(runJSON, `"run-1"`, `"run-2"`, 1)} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(body)) }))
		_, err := New(options(server.URL)).Run(context.Background(), "run-1")
		server.Close()
		require.ErrorIs(t, err, apperror.ErrUnavailable)
	}
}

func TestCancellationAndRedirectsDoNotLeakCredentials(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := New(options("http://127.0.0.1:1")).Run(ctx, "run-1")
	require.True(t, errors.Is(err, context.Canceled))
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://127.0.0.1:1/leak", http.StatusTemporaryRedirect)
	}))
	t.Cleanup(redirect.Close)
	_, err = New(options(redirect.URL)).Run(context.Background(), "run-1")
	require.ErrorIs(t, err, apperror.ErrUnavailable)
}
