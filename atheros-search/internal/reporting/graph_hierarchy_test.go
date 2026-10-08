package reporting

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestBuildPresentationTreePreservesFanoutAndSecondaryEvidence(t *testing.T) {
	root := "ap:root"
	nodes := []GraphNode{{ID: root, Kind: "ap"}, {ID: "ap:other", Kind: "ap"}, {ID: "device:unattached", Kind: "device"}}
	edges := []GraphEdge{}
	for i := 0; i < 250; i++ {
		id := fmt.Sprintf("device:%03d", i)
		nodes = append(nodes, GraphNode{ID: id, Kind: "device"})
		edges = append(edges, GraphEdge{ID: "observed:" + id, Source: id, Target: root, Kind: "association"})
	}
	edges = append(edges,
		GraphEdge{ID: "observed:other", Source: "device:001", Target: "ap:other", Kind: "observed_association"},
		GraphEdge{ID: "cycle", Source: "ap:other", Target: "device:002", Kind: "association"},
		GraphEdge{ID: "same", Source: "device:001", Target: "device:002", Kind: "same_device"},
		GraphEdge{ID: "rf", Source: "device:001", Target: "device:002", Kind: "rf_proximity"},
		GraphEdge{ID: "self", Source: root, Target: root, Kind: "association"},
		GraphEdge{ID: "dangling", Source: "absent", Target: root, Kind: "association"},
	)
	nodes, edges, hierarchy := buildPresentationTree(nodes, edges, root)
	require.Len(t, nodes, 253)
	require.Equal(t, []string{root, "device:unattached"}, hierarchy.RootIDs)
	byID := make(map[string]GraphNode, len(nodes))
	for _, node := range nodes {
		byID[node.ID] = node
		require.NotNil(t, node.Depth)
	}
	require.Nil(t, byID[root].ParentID)
	require.Equal(t, "root_ap", byID[root].Role)
	require.Zero(t, *byID[root].Depth)
	for i := 0; i < 250; i++ {
		node := byID[fmt.Sprintf("device:%03d", i)]
		require.Equal(t, root, *node.ParentID)
		require.Equal(t, 1, *node.Depth)
	}
	trees := 0
	for _, edge := range edges {
		require.Contains(t, byID, edge.Source)
		require.Contains(t, byID, edge.Target)
		if edge.TreeRole == "tree" {
			trees++
			require.True(t, isGraphAssociation(edge.Kind))
		} else {
			require.Equal(t, "secondary", edge.TreeRole)
		}
		if edge.ID == "same" || edge.ID == "rf" || edge.ID == "self" {
			require.Equal(t, "secondary", edge.TreeRole)
		}
	}
	require.Equal(t, 251, trees)
	// A second pass produces the same parents and edge roles despite input order.
	reversed := append([]GraphNode(nil), nodes...)
	for i, j := 0, len(reversed)-1; i < j; i, j = i+1, j-1 {
		reversed[i], reversed[j] = reversed[j], reversed[i]
	}
	gotNodes, gotEdges, gotHierarchy := buildPresentationTree(reversed, edges, root)
	require.Equal(t, nodes, gotNodes)
	require.Equal(t, edges, gotEdges)
	require.Equal(t, hierarchy, gotHierarchy)
}

func TestNormalizeHierarchyFilters(t *testing.T) {
	filters, err := NormalizeGraphFilters(GraphFilters{RootBSSID: " AA:BB:CC:DD:EE:FF ", RootNodeID: " ap:explicit "})
	require.NoError(t, err)
	require.True(t, filters.Hierarchy)
	require.Equal(t, "aa:bb:cc:dd:ee:ff", filters.RootBSSID)
	require.Equal(t, "ap:explicit", filters.RootNodeID)
	require.Equal(t, GraphMaxLimit, filters.Limit)
	_, err = NormalizeGraphFilters(GraphFilters{Hierarchy: true, Scope: "all", PageCursor: "cursor"})
	require.ErrorContains(t, err, "page_cursor is not supported for hierarchy")
}

func TestHierarchyReportsCapAndMissingProjectionEvidence(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer func() { _ = database.Close() }() // Best-effort test teardown.
	now := time.Now()
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)LEFT JOIN atheros_search.ap_catalog.*COALESCE\(ap.authorized, false\) DESC`).
		WillReturnRows(sqlmock.NewRows([]string{"node_id"}).AddRow("ap:root"))
	mock.ExpectQuery(`(?s)WITH RECURSIVE.*walk\(node_id\) AS.*UNION.*LIMIT \$2`).WithArgs("ap:root", 1).
		WillReturnRows(sqlmock.NewRows([]string{
			"node_id", "node_kind", "label", "node_payload", "location_id", "sensor_id",
			"normalized_mac", "normalized_ssid", "is_threat", "observed_at", "total", "missing",
		}).AddRow("ap:root", "access_point", "root", "{}", nil, nil, nil, nil, false, now, 31, 2))
	mock.ExpectQuery(`(?s)source_node_id IN \(\$1\) AND target_node_id IN \(\$1\).*ORDER BY edge_id`).WithArgs("ap:root").
		WillReturnRows(sqlmock.NewRows([]string{"edge_id", "source_node_id", "target_node_id", "edge_kind", "weight", "weight_basis", "label", "observed_at", "evidence"}))
	mock.ExpectCommit()
	result, err := (&Service{Pool: database}).Graph(context.Background(), GraphFilters{Hierarchy: true, Limit: 1})
	require.NoError(t, err)
	require.Len(t, result.Nodes, 1)
	require.Equal(t, "ap:root", result.Nodes[0].ID)
	require.True(t, result.Hierarchy.Truncated)
	require.Contains(t, result.Hierarchy.Reason, "showing 1 of 31")
	require.Contains(t, result.Hierarchy.Reason, "2 association relationships reference missing projected nodes")
	require.Equal(t, result.Hierarchy.Reason, result.FocusReason)
	require.NoError(t, mock.ExpectationsWereMet())
}
