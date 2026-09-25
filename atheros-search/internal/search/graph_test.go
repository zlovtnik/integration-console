package search

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestGraphLoadsEdgesForProjectedNodes(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()

	now := time.Now()
	mock.ExpectBegin()
	mock.ExpectQuery("FROM atheros_search.graph_nodes").WithArgs(200).
		WillReturnRows(sqlmock.NewRows([]string{
			"node_id", "node_kind", "label", "node_payload", "location_id", "sensor_id",
			"normalized_mac", "normalized_ssid", "is_threat", "observed_at",
		}).AddRow("device:aa:bb:cc:dd:ee:ff", "device", "device", "{}", nil, nil,
			"aa:bb:cc:dd:ee:ff", nil, false, now).
			AddRow("ap:11:22:33:44:55:66", "access_point", "ap", "{}", nil, nil,
				"11:22:33:44:55:66", nil, false, now))
	mock.ExpectQuery(`(?s)WHERE source_node_id IN \(\$1,\$2\).*OR target_node_id IN \(\$1,\$2\).*LIMIT \$3`).
		WithArgs("device:aa:bb:cc:dd:ee:ff", "ap:11:22:33:44:55:66", 200).
		WillReturnRows(sqlmock.NewRows([]string{
			"edge_id", "source_node_id", "target_node_id", "edge_kind", "weight", "label", "observed_at",
		}).AddRow("observed:1", "device:aa:bb:cc:dd:ee:ff", "ap:11:22:33:44:55:66",
			"observed_at", 1.0, "wireless observation", now))
	mock.ExpectCommit()

	graph, err := (&Service{Pool: database}).Graph(context.Background(), GraphFilters{})
	require.NoError(t, err)
	require.Equal(t, 2, graph.NodeCount)
	require.Equal(t, 1, graph.EdgeCount)
	require.Equal(t, "association", graph.Edges[0].Kind)
	require.NoError(t, mock.ExpectationsWereMet())
}

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
