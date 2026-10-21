package config

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestLoadWorkerSourceKinds(t *testing.T) {
	for _, tc := range []struct {
		value string
		want  []string
		bad   bool
	}{
		{value: ""},
		{value: "   "},
		{value: ",,,", bad: true},
		{value: " , , ", bad: true},
		{value: " proxy_event, proxy_blocked_host_window ", want: []string{"proxy_event", "proxy_blocked_host_window"}},
		{value: ",proxy_event,", want: []string{"proxy_event"}},
		{value: "typo", bad: true},
		{value: "proxy_event,proxy_event", bad: true},
	} {
		t.Run(tc.value, func(t *testing.T) {
			setRequiredPostgresEnv(t)
			t.Setenv("ATHSEARCH_WORKER_SOURCE_KINDS", tc.value)
			cfg, err := Load()
			if tc.bad {
				require.ErrorContains(t, err, "ATHSEARCH_WORKER_SOURCE_KINDS")
				return
			}
			require.NoError(t, err)
			require.Equal(t, tc.want, cfg.WorkerSourceKinds)
		})
	}
}

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
