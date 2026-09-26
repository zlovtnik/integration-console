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
	mock.ExpectQuery(`(?s)WHERE \(source_node_id IN \(\$1,\$2\).*OR target_node_id IN \(\$1,\$2\)\).*LIMIT \$3`).
		WithArgs("device:aa:bb:cc:dd:ee:ff", "ap:11:22:33:44:55:66", 200).
		WillReturnRows(sqlmock.NewRows([]string{
			"edge_id", "source_node_id", "target_node_id", "edge_kind", "weight", "weight_basis", "label", "observed_at",
		}).AddRow("observed:1", "device:aa:bb:cc:dd:ee:ff", "ap:11:22:33:44:55:66",
			"observed_at", 1.0, "frame_count", "wireless observation", now))
	mock.ExpectCommit()

	graph, err := (&Service{Pool: database}).Graph(context.Background(), GraphFilters{})
	require.NoError(t, err)
	require.Equal(t, 2, graph.NodeCount)
	require.Equal(t, 1, graph.EdgeCount)
	require.Equal(t, "association", graph.Edges[0].Kind)
	require.Equal(t, "frame_count", graph.Edges[0].WeightBasis)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestGraphAllScopeReturnsBoundedDeterministicPage(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()

	now := time.Now()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM atheros_search.graph_nodes`).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(3))
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\).*FROM atheros_search.graph_edges`).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(3))
	mock.ExpectQuery(`(?s)FROM atheros_search.graph_nodes n.*ORDER BY n.node_id.*LIMIT \$1`).
		WithArgs(3).
		WillReturnRows(sqlmock.NewRows([]string{
			"node_id", "node_kind", "label", "node_payload", "location_id", "sensor_id",
			"normalized_mac", "normalized_ssid", "is_threat", "observed_at",
		}).AddRow("node:1", "device", "one", "{}", nil, nil, nil, nil, false, now).
			AddRow("node:2", "device", "two", "{}", nil, nil, nil, nil, false, now).
			AddRow("node:3", "device", "three", "{}", nil, nil, nil, nil, false, now))
	mock.ExpectQuery(`(?s)SELECT e.edge_id.*ORDER BY e.edge_id.*LIMIT \$1`).
		WithArgs(3).
		WillReturnRows(sqlmock.NewRows([]string{
			"edge_id", "source_node_id", "target_node_id", "edge_kind", "weight", "weight_basis", "label", "observed_at",
		}).AddRow("edge:1", "node:1", "node:2", "observed_at", 1.0, nil, nil, now).
			AddRow("edge:2", "node:1", "node:3", "observed_at", 1.0, nil, nil, now).
			AddRow("edge:3", "node:2", "node:3", "observed_at", 1.0, nil, nil, now))
	mock.ExpectCommit()

	page, err := (&Service{Pool: database}).Graph(context.Background(), GraphFilters{Scope: "all", PageSize: 2})
	require.NoError(t, err)
	require.Equal(t, []string{"node:1", "node:2"}, []string{page.Nodes[0].ID, page.Nodes[1].ID})
	require.Equal(t, []string{"edge:1", "edge:2"}, []string{page.Edges[0].ID, page.Edges[1].ID})
	require.NotEmpty(t, page.NextPageCursor)
	require.Equal(t, 3, *page.TotalNodeCount)
	require.Equal(t, 3, *page.TotalEdgeCount)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestGraphAllScopeRejectsMalformedCursorBeforeQuery(t *testing.T) {
	_, err := (&Service{}).Graph(context.Background(), GraphFilters{Scope: "all", PageCursor: "%%%"})
	require.EqualError(t, err, "invalid page_cursor")
}

func TestGraphFocusNodeIDsExpandsNeighborhoodWithinFilters(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()

	mac := "aa:bb:cc:dd:ee:ff"
	anchor := "device:" + mac
	mock.ExpectBegin()
	tx, err := database.Begin()
	require.NoError(t, err)
	mock.ExpectQuery(`SELECT n\.node_id FROM atheros_search\.graph_nodes n WHERE \(1 = 1\) AND \(n\.node_id = \$1`).
		WithArgs(anchor, mac).
		WillReturnRows(sqlmock.NewRows([]string{"node_id"}).AddRow(anchor))
	mock.ExpectQuery(`(?s)WITH filtered_nodes AS`).
		WithArgs(anchor, "observed_at", anchor).
		WillReturnRows(sqlmock.NewRows([]string{"neighbor"}).AddRow("ap:11:22:33:44:55:66"))

	ids, err := graphFocusNodeIDs(context.Background(), tx, GraphFilters{
		SourceMAC: mac, Hops: 1, EdgeKinds: []string{"association"},
	})
	require.NoError(t, err)
	require.Equal(t, []any{anchor, "ap:11:22:33:44:55:66"}, ids)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestGraphFocusNodeIDsReturnsNothingWithoutAnchor(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()

	mac := "aa:bb:cc:dd:ee:ff"
	mock.ExpectBegin()
	tx, err := database.Begin()
	require.NoError(t, err)
	mock.ExpectQuery(`SELECT n\.node_id FROM atheros_search\.graph_nodes n WHERE \(1 = 1\) AND \(n\.node_id = \$1`).
		WithArgs("device:"+mac, mac).
		WillReturnRows(sqlmock.NewRows([]string{"node_id"}))

	ids, err := graphFocusNodeIDs(context.Background(), tx, GraphFilters{SourceMAC: mac, Hops: 2})
	require.NoError(t, err)
	require.Empty(t, ids)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestGraphAllScopeRestrictsPagesToSourceMACNeighborhood(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()

	now := time.Now()
	mac := "aa:bb:cc:dd:ee:ff"
	anchor := "device:" + mac
	neighbor := "ap:11:22:33:44:55:66"
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT n\.node_id FROM atheros_search\.graph_nodes n WHERE \(1 = 1\) AND \(n\.node_id = \$1`).
		WithArgs(anchor, mac).
		WillReturnRows(sqlmock.NewRows([]string{"node_id"}).AddRow(anchor))
	mock.ExpectQuery(`(?s)WITH filtered_nodes AS`).
		WithArgs(anchor, anchor).
		WillReturnRows(sqlmock.NewRows([]string{"neighbor"}).AddRow(neighbor))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM atheros_search\.graph_nodes n WHERE`).
		WithArgs(anchor, neighbor).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))
	mock.ExpectQuery(`(?s)WITH filtered_nodes AS.*SELECT COUNT\(\*\)`).
		WithArgs(anchor, neighbor).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(`(?s)SELECT n\.node_id, n\.node_kind.*ORDER BY n\.node_id.*LIMIT \$3`).
		WithArgs(anchor, neighbor, 501).
		WillReturnRows(sqlmock.NewRows([]string{
			"node_id", "node_kind", "label", "node_payload", "location_id", "sensor_id",
			"normalized_mac", "normalized_ssid", "is_threat", "observed_at",
		}).AddRow(anchor, "device", "anchor", "{}", nil, nil, mac, nil, false, now).
			AddRow(neighbor, "access_point", "ap", "{}", nil, nil, "11:22:33:44:55:66", nil, false, now))
	mock.ExpectQuery(`(?s)SELECT e\.edge_id.*ORDER BY e\.edge_id.*LIMIT \$3`).
		WithArgs(anchor, neighbor, 501).
		WillReturnRows(sqlmock.NewRows([]string{
			"edge_id", "source_node_id", "target_node_id", "edge_kind", "weight", "weight_basis", "label", "observed_at",
		}).AddRow("observed:1", anchor, neighbor, "observed_at", 1.0, "frame_count", "wireless observation", now))
	mock.ExpectCommit()

	page, err := (&Service{Pool: database}).Graph(context.Background(), GraphFilters{
		Scope: "all", SourceMAC: mac, Hops: 1,
	})
	require.NoError(t, err)
	require.Equal(t, 2, page.NodeCount)
	require.Equal(t, 1, page.EdgeCount)
	require.Equal(t, 2, *page.TotalNodeCount)
	require.Equal(t, 1, *page.TotalEdgeCount)
	require.Equal(t, []string{anchor, neighbor}, []string{page.Nodes[0].ID, page.Nodes[1].ID})
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestGraphFiltersEdgesByEdgeKind(t *testing.T) {
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
			"aa:bb:cc:dd:ee:ff", nil, false, now))
	mock.ExpectQuery(`(?s)AND edge_kind IN \(\$2\).*LIMIT \$3`).
		WithArgs("device:aa:bb:cc:dd:ee:ff", "observed_at", 200).
		WillReturnRows(sqlmock.NewRows([]string{
			"edge_id", "source_node_id", "target_node_id", "edge_kind", "weight", "weight_basis", "label", "observed_at",
		}))
	mock.ExpectCommit()

	_, err = (&Service{Pool: database}).Graph(context.Background(), GraphFilters{EdgeKinds: []string{"association"}})
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestNormalizeGraphFiltersDefaultsAndMapsKinds(t *testing.T) {
	got, err := normalizeGraphFilters(GraphFilters{
		Kinds:       []string{"access_point", "identity_cluster", "ap", " device "},
		EdgeKinds:   []string{"association", "observed_at", "cluster_member", "roaming", ""},
		LocationIDs: []string{" lab ", "lab", ""},
		SensorIDs:   []string{" sensor-1 ", "sensor-1"},
		SourceMAC:   " AA:BB:CC:DD:EE:FF ",
		Hops:        5,
		Limit:       5000,
	})
	require.NoError(t, err)
	require.Equal(t, graphMaxLimit, got.Limit)
	require.Equal(t, graphMaxHops, got.Hops)
	require.Equal(t, []string{"ap", "cluster", "device"}, got.Kinds)
	require.Equal(t, []string{"association", "cluster_member", "roaming"}, got.EdgeKinds)
	require.Equal(t, []string{"lab"}, got.LocationIDs)
	require.Equal(t, []string{"sensor-1"}, got.SensorIDs)
	require.Equal(t, "aa:bb:cc:dd:ee:ff", got.SourceMAC)

	defaults, err := normalizeGraphFilters(GraphFilters{})
	require.NoError(t, err)
	require.Equal(t, 1, defaults.Hops)
}

func TestNormalizeGraphFiltersRejectsInvertedRange(t *testing.T) {
	after, err := time.Parse(time.RFC3339, "2026-06-02T00:00:00Z")
	require.NoError(t, err)
	before, err := time.Parse(time.RFC3339, "2026-06-01T00:00:00Z")
	require.NoError(t, err)
	_, err = normalizeGraphFilters(GraphFilters{ObservedAfter: &after, ObservedBefore: &before})
	require.ErrorContains(t, err, "observed_after must be before observed_before")
}

func TestNormalizeGraphFiltersEnablesBoundedAllScope(t *testing.T) {
	got, err := normalizeGraphFilters(GraphFilters{Scope: "all", PageSize: graphMaxLimit + 1})
	require.NoError(t, err)
	require.Equal(t, maxPageSize, got.PageSize)

	_, err = normalizeGraphFilters(GraphFilters{PageCursor: "opaque"})
	require.ErrorContains(t, err, "page_cursor requires scope all")
	_, err = normalizeGraphFilters(GraphFilters{Scope: "everything"})
	require.ErrorContains(t, err, "unsupported scope")
}

func TestMapGraphKindsRoundTrip(t *testing.T) {
	require.Equal(t, "ap", mapGraphNodeKind("access_point"))
	require.Equal(t, "cluster", mapGraphNodeKind("identity_cluster"))
	require.Equal(t, "access_point", graphNodeKindToDB("ap"))
	require.Equal(t, "identity_cluster", graphNodeKindToDB("cluster"))
	require.Equal(t, "association", mapGraphEdgeKind("observed_at"))
	require.Equal(t, "cluster_member", mapGraphEdgeKind("identity_member"))
	require.Equal(t, "observed_at", graphEdgeKindToDB("association"))
	require.Equal(t, "identity_member", graphEdgeKindToDB("cluster_member"))
	require.Equal(t, "roaming", graphEdgeKindToDB("roaming"))
}

func TestFocusGraphAroundMACExpandsTwoHops(t *testing.T) {
	anchor := "device:aa:aa:aa:aa:aa:aa"
	middle := "device:bb:bb:bb:bb:bb:bb"
	leaf := "device:cc:cc:cc:cc:cc:cc"
	island := "device:dd:dd:dd:dd:dd:dd"
	nodes := []GraphNode{
		{ID: anchor, Kind: "device", MAC: "aa:aa:aa:aa:aa:aa"},
		{ID: middle, Kind: "device", MAC: "bb:bb:bb:bb:bb:bb"},
		{ID: leaf, Kind: "device", MAC: "cc:cc:cc:cc:cc:cc"},
		{ID: island, Kind: "device", MAC: "dd:dd:dd:dd:dd:dd"},
	}
	edges := []GraphEdge{
		{ID: "e1", Source: anchor, Target: middle, Kind: "rf_proximity"},
		{ID: "e2", Source: middle, Target: leaf, Kind: "rf_proximity"},
		{ID: "e3", Source: island, Target: leaf, Kind: "rf_proximity"},
	}

	focusedNodes, focusedEdges := focusGraphAroundMAC(nodes, edges, "aa:aa:aa:aa:aa:aa", 1)
	require.Len(t, focusedNodes, 2)
	require.Len(t, focusedEdges, 1)

	focusedNodes, focusedEdges = focusGraphAroundMAC(nodes, edges, "aa:aa:aa:aa:aa:aa", 2)
	require.Len(t, focusedNodes, 3)
	require.Len(t, focusedEdges, 2)

	focusedNodes, focusedEdges = focusGraphAroundMAC(nodes, edges, "aa:aa:aa:aa:aa:aa", graphMaxHops)
	require.Len(t, focusedNodes, 3)
	require.Len(t, focusedEdges, 2)
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
