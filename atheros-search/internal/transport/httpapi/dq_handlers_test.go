package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/auth"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/dedup"
)

func TestHTTPStartsWithDQDisabledOrAbsent(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		ctx, cancel := context.WithCancel(context.Background())
		svc := dedup.New(dedup.Options{Enabled: enabled, ManagerURL: "http://127.0.0.1:1", Timeout: time.Second})
		server, err := StartHTTP(ctx, 0, nil, Services{DQ: svc}, nil, nil, nil, false, zerolog.Nop())
		require.NoError(t, err)
		response := httptest.NewRecorder()
		server.Handler.ServeHTTP(response, httptest.NewRequest("GET", "/v1/healthz", nil))
		require.Equal(t, 200, response.Code)
		response = httptest.NewRecorder()
		server.Handler.ServeHTTP(response, httptest.NewRequest("GET", "/dq-ui/embedded.html", nil))
		if enabled {
			require.Equal(t, 503, response.Code)
		} else {
			require.Equal(t, 404, response.Code)
		}
		cancel()
		require.NoError(t, server.Close())
	}
}

func TestDQRolesScopeAndCapacity(t *testing.T) {
	for _, role := range []string{auth.RoleViewer, auth.RoleOperator, auth.RoleAdmin} {
		t.Run(role, func(t *testing.T) {
			calls := 0
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				require.Equal(t, "Bearer delegated", r.Header.Get("Authorization"))
				require.Empty(t, r.Header.Get("Cookie"))
				if r.Method == "POST" {
					var body map[string]any
					require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
					require.Equal(t, "test", body["installation_id"])
					require.Equal(t, "audit", body["namespace"])
				}
				w.WriteHeader(429)
			}))
			t.Cleanup(upstream.Close)
			svc := dedup.New(dedup.Options{Enabled: true, ManagerURL: upstream.URL, ServiceToken: "delegated", InstallationID: "test", Namespace: "audit", Timeout: time.Second})
			tokenAuth, token := savedViewJWTAuth(t, "subject", "user", role)
			mux := runtime.NewServeMux()
			require.NoError(t, registerDQRoutes(mux, tokenAuth, svc))
			mutationStatus := 429
			if role == auth.RoleViewer {
				mutationStatus = 403
			}
			for _, tc := range []struct {
				method, path, body string
				status             int
			}{
				{"GET", "/v1/dq/context", "", 200},
				{"GET", "/v1/dq/processors", "", 429},
				{"POST", "/v1/dq/runs", `{"processor_id":"atheros.dedup","processor_version":"0.1.0","operation":"prepare_candidates","parameters":{"authorized_scope":"*"},"idempotency_key":"key"}`, mutationStatus},
				{"POST", "/v1/dq/runs/run-1/cancel", `{}`, mutationStatus},
				{"POST", "/v1/dq/runs/run-1/replay", `{"idempotency_key":"key"}`, mutationStatus},
				{"POST", "/v1/dq/artifacts/artifact-1/access", `{}`, 429},
				{"GET", "/v1/dq/processors?installation_id=other", "", 400},
			} {
				req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
				req.Header.Set("Authorization", "Bearer "+token)
				response := httptest.NewRecorder()
				mux.ServeHTTP(response, req)
				require.Equal(t, tc.status, response.Code, tc.path)
			}
			require.Positive(t, calls)
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, httptest.NewRequest("GET", "/v1/dq/context", nil))
			require.Equal(t, 401, response.Code)
			if role != auth.RoleViewer {
				for _, body := range []string{`{"installation_id":"outside"}`, `{"namespace":"outside"}`, `{"execution_mode":"enabled"}`, `null`, `{} {}`, strings.Repeat("x", 65537)} {
					before := calls
					req := httptest.NewRequest("POST", "/v1/dq/runs/run-1/cancel", strings.NewReader(body))
					req.Header.Set("Authorization", "Bearer "+token)
					response := httptest.NewRecorder()
					mux.ServeHTTP(response, req)
					require.Contains(t, []int{400, 413}, response.Code)
					require.Equal(t, before, calls)
				}
			}
		})
	}
}

func TestDQDisabledContextAndRoutes(t *testing.T) {
	mux := runtime.NewServeMux()
	require.NoError(t, registerDQRoutes(mux, nil, nil))
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest("GET", "/v1/dq/context", nil))
	require.Equal(t, 200, response.Code)
	require.Contains(t, response.Body.String(), `"enabled":false`)
	response = httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest("GET", "/v1/dq/processors", nil))
	require.Equal(t, 403, response.Code)
}
