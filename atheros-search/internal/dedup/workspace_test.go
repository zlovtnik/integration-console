package dedup

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/apperror"
)

func TestWorkspaceCancellationReplayAndArtifacts(t *testing.T) {
	artifact := Artifact{ArtifactID: "a1", InstallationID: "test", Namespace: "audit", ProducerRunID: "run-1", VersionID: "v1", SHA256: strings.Repeat("a", 64)}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "Bearer service-secret", r.Header.Get("Authorization"))
		if r.Method == "GET" {
			require.Equal(t, "test", r.URL.Query().Get("installation_id"))
			require.Equal(t, "audit", r.URL.Query().Get("namespace"))
		} else {
			var body map[string]any
			require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
			require.Equal(t, "test", body["installation_id"])
			require.Equal(t, "audit", body["namespace"])
			if strings.HasSuffix(r.URL.Path, "/replay") {
				require.Equal(t, "retry-1", body["idempotency_key"])
			}
		}
		switch r.URL.Path {
		case "/v1/artifacts/a1":
			require.NoError(t, json.NewEncoder(w).Encode(artifact))
		case "/v1/artifacts/a1/access":
			_, _ = w.Write([]byte(`{"download_url":"https://objects.example.test/version?v=1"}`))
		default:
			run := WorkspaceRun{Run: Run{RunID: "run-1", InstallationID: "test", Namespace: "audit", ProcessorID: "atheros.dedup", ProcessorVersion: "0.1.0", Operation: "prepare_candidates", Status: "succeeded"}}
			if strings.HasSuffix(r.URL.Path, "/cancel") {
				run.Status = "cancelled"
			}
			if strings.HasSuffix(r.URL.Path, "/replay") {
				run.RunID = "run-2"
				run.Status = "queued"
			}
			require.NoError(t, json.NewEncoder(w).Encode(run))
		}
	}))
	t.Cleanup(server.Close)
	svc := New(options(server.URL))
	ctx := context.Background()
	run, err := svc.Cancel(ctx, "run-1")
	require.NoError(t, err)
	require.Equal(t, "cancelled", run.Status)
	run, err = svc.Replay(ctx, "run-1", "retry-1")
	require.NoError(t, err)
	require.Equal(t, "run-2", run.RunID)
	access, err := svc.Access(ctx, "a1")
	require.NoError(t, err)
	require.Contains(t, access.DownloadURL, "https://objects.example.test/")
}

func TestWorkspaceRejectsMetadataAndArtifactAuthorizationFailures(t *testing.T) {
	for _, body := range []string{`null`, `{}`, `{"items":[{"installation_id":"outside"}]}`, strings.Repeat("x", 65537)} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(body)) }))
		_, err := New(options(server.URL)).Catalog(context.Background())
		server.Close()
		require.ErrorIs(t, err, apperror.ErrUnavailable)
	}
	for _, status := range []int{302, 403, 404, 503} {
		calls := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls++
			require.NotContains(t, r.URL.Path, "/access")
			w.Header().Set("Location", "http://127.0.0.1:1")
			w.WriteHeader(status)
		}))
		_, err := New(options(server.URL)).Access(context.Background(), "a1")
		server.Close()
		require.Error(t, err)
		require.Equal(t, 1, calls)
	}
}

func TestShellAssetProxyIsRestrictedAndCredentialFree(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		require.Empty(t, r.Header.Get("Authorization"))
		require.Empty(t, r.Header.Get("Cookie"))
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("shell"))
	}))
	t.Cleanup(server.Close)
	svc := New(options(server.URL))
	for _, tc := range []struct {
		method, path string
		status       int
	}{{"GET", "/dq-ui/embedded.html", 200}, {"HEAD", "/dq-ui/assets/embedded-abc.js", 200}, {"POST", "/dq-ui/embedded.html", 405}, {"GET", "/dq-ui/v1/runs", 404}, {"GET", "/dq-ui/assets/../../secret", 404}, {"GET", "/dq-ui/embedded.html?token=x", 404}} {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		req.Header.Set("Authorization", "Bearer user")
		req.Header.Set("Cookie", "session=user")
		response := httptest.NewRecorder()
		svc.ServeAssets(response, req)
		require.Equal(t, tc.status, response.Code)
		if tc.status == 200 {
			require.Empty(t, response.Header().Get("X-Frame-Options"))
			require.Contains(t, response.Header().Get("Content-Security-Policy"), "frame-ancestors 'self'")
		}
	}
	require.Equal(t, 2, calls)
}
