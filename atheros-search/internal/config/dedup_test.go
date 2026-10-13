package config

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestDedupDisabledByDefaultAndEnabledRequiresAuthenticatedPrerequisites(t *testing.T) {
	setRequiredPostgresEnv(t)
	t.Setenv("ATHSEARCH_DQ_ENABLED", "false")
	cfg, err := Load()
	require.NoError(t, err)
	require.False(t, cfg.DQEnabled)
	require.Equal(t, 5*time.Second, cfg.DQTimeout)
	t.Setenv("ATHSEARCH_DQ_ENABLED", "true")
	_, err = Load()
	require.ErrorContains(t, err, "ATHSEARCH_DQ_MANAGER_URL")
	t.Setenv("ATHSEARCH_DQ_MANAGER_URL", "http://delip-queve-manager:8080")
	t.Setenv("ATHSEARCH_DQ_SERVICE_TOKEN", "delegated")
	t.Setenv("ATHSEARCH_DQ_INSTALLATION_ID", "test")
	t.Setenv("ATHSEARCH_DQ_NAMESPACE", "audit")
	_, err = Load()
	require.ErrorContains(t, err, "authenticated")
	t.Setenv("ATHSEARCH_API_TOKEN_SHA256", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	_, err = Load()
	require.NoError(t, err)
	t.Setenv("ATHSEARCH_DQ_TIMEOUT_SECONDS", "31")
	_, err = Load()
	require.ErrorContains(t, err, "between 1 and 30")
}

func TestDedupRejectsAmbiguousManagerURLs(t *testing.T) {
	for _, managerURL := range []string{"http://user:password@manager", "https://manager?token=secret", "https://manager/api", "https://manager#fragment", "file:///tmp/run"} {
		err := validateDQ(Config{DQEnabled: true, DQManagerURL: managerURL})
		require.ErrorContains(t, err, "ATHSEARCH_DQ_MANAGER_URL")
	}
}
