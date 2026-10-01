//go:build dbcontract

package etlhealth

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/testdb"
)

func TestDatabaseETLHealthUsesRuntimeColumnGrants(t *testing.T) {
	monitor := NewHealthMonitor(testdb.Runtime(t))
	snapshot, err := monitor.snapshotFromDB(t.Context())
	require.NoError(t, err)
	require.NotZero(t, snapshot.MeasuredAt)
}
