package metrics

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/require"
)

func TestNewInitializesStableZeroValuedSeries(t *testing.T) {
	registry := prometheus.NewRegistry()
	NewForRegisterer(registry)

	families, err := registry.Gather()
	require.NoError(t, err)
	byName := make(map[string]int, len(families))
	for _, family := range families {
		byName[family.GetName()] = len(family.Metric)
	}
	require.Equal(t, 40, byName["athsearch_search_requests_total"])
	require.Equal(t, 20, byName["athsearch_search_latency_ms"])
	require.Equal(t, 5, byName["athsearch_results_returned_total"])
}

func TestStartServerReturnsBindFailure(t *testing.T) {
	listener, err := net.Listen("tcp", "[::]:0")
	require.NoError(t, err)
	defer func() { _ = listener.Close() }() // Best-effort test teardown; assertions verify the operation before cleanup.
	port := listener.Addr().(*net.TCPAddr).Port

	server, err := StartServer(context.Background(), port, false)
	require.Nil(t, server)
	require.Error(t, err)
}

func TestProfilingRoutesAreOptIn(t *testing.T) {
	for _, profilingEnabled := range []bool{false, true} {
		t.Run(fmt.Sprintf("enabled_%t", profilingEnabled), func(t *testing.T) {
			server, err := StartServer(context.Background(), 0, profilingEnabled)
			require.NoError(t, err)
			t.Cleanup(func() { _ = server.Close() })

			response, err := http.Get("http://" + server.Addr + "/debug/pprof/")
			require.NoError(t, err)
			defer func() { _ = response.Body.Close() }() // Best-effort test teardown; assertions verify the operation before cleanup.
			body, err := io.ReadAll(response.Body)
			require.NoError(t, err)
			if profilingEnabled {
				require.Equal(t, http.StatusOK, response.StatusCode)
				require.Contains(t, string(body), "goroutine")
			} else {
				require.Equal(t, http.StatusNotFound, response.StatusCode)
			}
		})
	}
}

func TestProfilingCaptureDurationsAreBounded(t *testing.T) {
	server, err := StartServer(context.Background(), 0, true)
	require.NoError(t, err)
	t.Cleanup(func() { _ = server.Close() })

	for _, path := range []string{
		"/debug/pprof/profile?seconds=31",
		"/debug/pprof/trace?seconds=6",
		"/debug/pprof/profile?seconds=invalid",
	} {
		response, err := http.Get("http://" + server.Addr + path)
		require.NoError(t, err)
		_ = response.Body.Close()
		require.Equal(t, http.StatusBadRequest, response.StatusCode, path)
	}
}
