package httpapi

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/auth"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/operations"
)

func TestOperationsAuthorizeEveryRequestBeforeSharedCache(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kty": "RSA", "use": "sig", "kid": "operations-key",
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}}})
	}))
	t.Cleanup(jwks.Close)
	issuer := "https://issuer.example.test/realms/test"
	tokenAuth, err := auth.NewJWTTokenAuth(auth.JWTConfig{Issuer: issuer, JWKSURI: jwks.URL, Audience: "atheros-search-ui", ClientID: "atheros-search-ui"})
	require.NoError(t, err)
	token := func(role string, expiry time.Time) string {
		return signSavedViewJWT(t, key, "operations-key", map[string]any{
			"iss": issuer, "aud": "atheros-search-ui", "exp": expiry.Unix(), "sub": "same-identity",
			"resource_access": map[string]any{"atheros-search-ui": map[string]any{"roles": []string{role}}},
		})
	}
	var calls atomic.Int64
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"schema_version": 1, "measured_at": time.Now().UTC(), "instance_id": "opaque", "active_tunnels": 2,
			"counters":        map[string]int{"tunnels_opened": 1, "bytes_up": 1, "bytes_down": 1, "blocked": 0, "allowed": 1, "obfuscated": 0, "host_stats_dropped": 0},
			"classifications": map[string]int{"ads_tracker": 0, "analytics": 0, "cdn": 0, "essential_api": 0, "auth": 0, "unknown": 1},
			"publisher":       map[string]any{"configured": false, "status": "disabled", "queue_depth": 0, "queue_capacity": 0, "spooled_total": 0, "enqueue_timeouts_total": 0},
		})
	}))
	t.Cleanup(upstream.Close)
	mux := runtime.NewServeMux()
	require.NoError(t, registerOperationsRoutes(mux, tokenAuth, operations.New(nil, upstream.URL, "")))
	validUntil := time.Now().Add(time.Minute)
	operator, viewer := token(auth.RoleOperator, validUntil), token(auth.RoleViewer, validUntil)
	for _, test := range []struct {
		path, bearer string
		status       int
	}{
		{"/v1/operations/proxy/live", operator, http.StatusOK},
		{"/v1/operations/proxy/live", operator, http.StatusOK},
		{"/v1/operations/proxy/live", viewer, http.StatusForbidden},
		{"/v1/operations/proxy/live", "wrong", http.StatusUnauthorized},
		{"/v1/operations/proxy/live", token(auth.RoleOperator, time.Now().Add(-time.Minute)), http.StatusUnauthorized},
		{"/v1/operations/pipeline", viewer, http.StatusOK},
		{"/v1/operations/sources", viewer, http.StatusOK},
		{"/v1/operations/pipeline", "wrong", http.StatusUnauthorized},
		{"/v1/operations/sources", "", http.StatusUnauthorized},
	} {
		request := httptest.NewRequest(http.MethodGet, test.path, nil)
		if test.bearer != "" {
			request.Header.Set("Authorization", "Bearer "+test.bearer)
		}
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		require.Equal(t, test.status, response.Code, test.path)
		if test.status == http.StatusOK {
			require.Equal(t, "no-store", response.Header().Get("Cache-Control"))
		} else {
			require.NotContains(t, response.Body.String(), "active_tunnels")
		}
	}
	require.Equal(t, int64(1), calls.Load(), "cache is shared only after per-request authorization, including role changes")
}
