package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/auth"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/dedup"
)

type dedupStub struct{ calls int }

func (s *dedupStub) Admit(context.Context, dedup.Request) (*dedup.Run, error) {
	s.calls++
	return &dedup.Run{RunID: "run-1", Status: "queued", ProjectionApplied: false}, nil
}
func (s *dedupStub) Run(context.Context, string) (*dedup.Run, error) {
	s.calls++
	return &dedup.Run{RunID: "run-1", Status: "succeeded", ProjectionApplied: false}, nil
}

func TestDedupRoutesAreAdditiveAuthenticatedAndStrict(t *testing.T) {
	sum := sha256.Sum256([]byte("token"))
	tokenAuth, err := auth.NewTokenAuth(hex.EncodeToString(sum[:]))
	require.NoError(t, err)
	mux := runtime.NewServeMux()
	stub := &dedupStub{}
	require.NoError(t, registerDedupRoutes(mux, tokenAuth, stub))
	for _, test := range []struct {
		method, path, body, bearer string
		status                     int
	}{
		{"POST", "/v1/dedup/runs", `{}`, "", 401},
		{"POST", "/v1/dedup/runs", `{"execution_mode":"enabled"}`, "token", 400},
		{"POST", "/v1/dedup/runs", `{} {}`, "token", 400},
		{"POST", "/v1/dedup/runs", `{}`, "token", 202},
		{"GET", "/v1/dedup/runs/run-1", "", "token", 200},
	} {
		request := httptest.NewRequest(test.method, test.path, strings.NewReader(test.body))
		if test.bearer != "" {
			request.Header.Set("Authorization", "Bearer "+test.bearer)
		}
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		require.Equal(t, test.status, response.Code)
	}
	require.Equal(t, 2, stub.calls)
}

func TestDedupRouteUnavailableWithoutFeature(t *testing.T) {
	mux := runtime.NewServeMux()
	require.NoError(t, registerDedupRoutes(mux, nil, nil))
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest("GET", "/v1/dedup/runs/run-1", nil))
	require.Equal(t, http.StatusForbidden, response.Code)
}
