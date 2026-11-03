//go:build dbcontract

package worker

import (
	"context"
	"os"
	"strconv"
	"testing"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/testdb"
)

// TestRetainedProxyReplayWorker is invoked by Octopus after it prepares the
// retained corpus in the same ephemeral canonical database.
func TestRetainedProxyReplayWorker(t *testing.T) {
	expectedJobs, provided := os.LookupEnv("ATHSEARCH_REPLAY_EXPECTED_JOBS")
	if !provided {
		t.Skip("run the retained proxy replay from Octopus")
	}
	expected, err := strconv.Atoi(expectedJobs)
	require.NoError(t, err)
	require.Contains(t, []int{0, 9}, expected)
	database := testdb.Runtime(t)
	backend := &retainedProxyEmbedder{t: t}
	logger := zerolog.Nop()
	pool := NewPool(database, backend, PoolConfig{
		SourceKinds:    []string{"proxy_event", "proxy_blocked_host_window"},
		EmbeddingModel: "nomic-embed-text-v2-moe",
		InputRevision:  "legacy_unknown",
		BatchSize:      16,
	}, logger)
	pool.processBatch(t.Context(), "retained-proxy-replay", logger)
	require.Equal(t, expected, backend.embedded)
}

type retainedProxyEmbedder struct {
	t        *testing.T
	embedded int
}

func (e *retainedProxyEmbedder) Embed(_ context.Context, texts []string, kind string) ([][]float32, error) {
	e.t.Helper()
	require.Equal(e.t, "event", kind)
	vectors := make([][]float32, len(texts))
	for i, text := range texts {
		require.Contains(e.t, text, "proxy")
		require.NotContains(e.t, text, "hmac:synthetic")
		vectors[i] = testVector()
	}
	e.embedded += len(texts)
	return vectors, nil
}
