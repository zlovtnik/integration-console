package config

import (
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
)

func TestProxyWorkerScopeAndEmbeddingInputRevisionFailClosed(t *testing.T) {
	t.Setenv("ATHSEARCH_POSTGRES_DSN", "postgres://test:test@127.0.0.1/sync?sslmode=disable")
	t.Setenv("ATHSEARCH_WORKER_SOURCE_KINDS", "proxy_event,typo")
	_, err := Load()
	require.ErrorContains(t, err, "SOURCE_KINDS")
	t.Setenv("ATHSEARCH_WORKER_SOURCE_KINDS", "proxy_event,proxy_blocked_host_window")
	t.Setenv("ATHSEARCH_EMBEDDING_INPUT_REVISION", "nomic-prefix-v1:"+strings.Repeat("a", 64))
	t.Setenv("ATHSEARCH_EMBEDDING_PREFIX_OWNER", "legacy")
	_, err = Load()
	require.ErrorContains(t, err, "configured together")
}
