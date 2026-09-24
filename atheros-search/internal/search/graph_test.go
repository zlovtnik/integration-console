package search

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestNormalizeGraphFiltersDefaultsAndMapsKinds(t *testing.T) {
	got, err := normalizeGraphFilters(GraphFilters{
		Kinds:       []string{"access_point", "identity_cluster", "ap", " device "},
		LocationIDs: []string{" lab ", "lab", ""},
		SensorIDs:   []string{" sensor-1 ", "sensor-1"},
		SourceMAC:   " AA:BB:CC:DD:EE:FF ",
		Limit:       5000,
	})
	require.NoError(t, err)
	require.Equal(t, graphMaxLimit, got.Limit)
	require.Equal(t, []string{"ap", "cluster", "device"}, got.Kinds)
	require.Equal(t, []string{"lab"}, got.LocationIDs)
	require.Equal(t, []string{"sensor-1"}, got.SensorIDs)
	require.Equal(t, "aa:bb:cc:dd:ee:ff", got.SourceMAC)
}

func TestNormalizeGraphFiltersRejectsInvertedRange(t *testing.T) {
	after, err := time.Parse(time.RFC3339, "2026-06-02T00:00:00Z")
	require.NoError(t, err)
	before, err := time.Parse(time.RFC3339, "2026-06-01T00:00:00Z")
	require.NoError(t, err)
	_, err = normalizeGraphFilters(GraphFilters{ObservedAfter: &after, ObservedBefore: &before})
	require.ErrorContains(t, err, "observed_after must be before observed_before")
}

func TestMapGraphKindsRoundTrip(t *testing.T) {
	require.Equal(t, "ap", mapGraphNodeKind("access_point"))
	require.Equal(t, "cluster", mapGraphNodeKind("identity_cluster"))
	require.Equal(t, "access_point", graphNodeKindToDB("ap"))
	require.Equal(t, "identity_cluster", graphNodeKindToDB("cluster"))
	require.Equal(t, "association", mapGraphEdgeKind("observed_at"))
	require.Equal(t, "cluster_member", mapGraphEdgeKind("identity_member"))
}

func TestNormalizeMergeDecisionAcceptsContractValues(t *testing.T) {
	for _, value := range []string{"merge", "not_match", "needs_more_data"} {
		got, err := normalizeMergeDecision(value)
		require.NoError(t, err)
		require.Equal(t, MergeDecision(value), got)
	}
	_, err := normalizeMergeDecision("undo_merge")
	require.ErrorContains(t, err, "unsupported merge decision")
}
