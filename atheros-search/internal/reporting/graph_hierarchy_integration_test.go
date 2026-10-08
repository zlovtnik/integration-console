//go:build dbcontract

package reporting

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/testdb"
)

func TestReportingHierarchyCompleteFanoutCyclesCapsAndOrphans(t *testing.T) {
	db := testdb.Provision(t)
	runtimeDB := testdb.Runtime(t)
	ctx := context.Background()
	_, err := db.Exec(`TRUNCATE atheros_search.graph_nodes, atheros_search.graph_edges, atheros_search.ap_catalog;
 INSERT INTO atheros_search.ap_catalog(bssid,authorized,first_observed_at,last_observed_at)
 VALUES ('10:20:30:40:50:60',true,'2026-09-01','2026-09-02'),
 ('10:20:30:40:50:61',false,'2026-09-01','2026-09-03');
 INSERT INTO atheros_search.graph_nodes(node_id,node_kind,normalized_mac,location_id,observed_at,projection_run_id)
 VALUES ('ap:10:20:30:40:50:60','access_point','10:20:30:40:50:60','lab','2026-09-02','test'),
 ('ap:10:20:30:40:50:61','access_point','10:20:30:40:50:61','lab','2026-09-03','test'),
 ('device:unattached','device','00:00:00:00:00:00','lab','2026-09-02','test');
 INSERT INTO atheros_search.graph_nodes(node_id,node_kind,normalized_mac,location_id,observed_at,projection_run_id)
 SELECT 'device:aa:bb:cc:dd:ee:'||lpad(to_hex(i),2,'0'),'device',
 'aa:bb:cc:dd:ee:'||lpad(to_hex(i),2,'0'),'lab','2026-09-02','test'
 FROM generate_series(1,250) i;
 INSERT INTO atheros_search.graph_edges(edge_id,source_node_id,target_node_id,edge_kind,weight,projection_run_id)
 SELECT 'observed:'||i,'device:aa:bb:cc:dd:ee:'||lpad(to_hex(i),2,'0'),
 'ap:10:20:30:40:50:60','observed_at',1,'test' FROM generate_series(1,250) i;
 INSERT INTO atheros_search.graph_edges(edge_id,source_node_id,target_node_id,edge_kind,weight,projection_run_id)
 VALUES ('other-ap','device:aa:bb:cc:dd:ee:01','ap:10:20:30:40:50:61','observed_at',1,'test'),
 ('cycle','device:aa:bb:cc:dd:ee:02','ap:10:20:30:40:50:61','observed_at',1,'test'),
 ('rf','device:aa:bb:cc:dd:ee:01','device:aa:bb:cc:dd:ee:02','rf_proximity',1,'test'),
 ('same','device:aa:bb:cc:dd:ee:01','device:aa:bb:cc:dd:ee:02','same_device',1,'test'),
 ('self','ap:10:20:30:40:50:60','ap:10:20:30:40:50:60','observed_at',1,'test'),
 ('missing','device:missing','ap:10:20:30:40:50:60','observed_at',1,'test')`)
	require.NoError(t, err)
	svc := &Service{Pool: runtimeDB}
	result, err := svc.Graph(ctx, GraphFilters{Hierarchy: true, LocationIDs: []string{"lab"}, Hops: 1})
	require.NoError(t, err)
	require.Equal(t, "ap:10:20:30:40:50:60", result.Hierarchy.RootID)
	require.Len(t, result.Nodes, 253)
	require.Len(t, result.Edges, 255)
	require.Equal(t, []string{"ap:10:20:30:40:50:60", "device:unattached"}, result.Hierarchy.RootIDs)
	require.True(t, result.Hierarchy.Truncated)
	require.Contains(t, result.Hierarchy.Reason, "1 association relationships reference missing projected nodes")
	assertClosedHierarchy(t, result)
	for _, node := range result.Nodes {
		if node.Kind == "device" && node.ID != "device:unattached" {
			require.Equal(t, result.Hierarchy.RootID, *node.ParentID)
			require.Equal(t, 1, *node.Depth)
		}
	}
	for _, edge := range result.Edges {
		if edge.ID == "same" || edge.ID == "rf" || edge.ID == "self" {
			require.Equal(t, "secondary", edge.TreeRole)
		}
	}
	// Removing the broken projection endpoint makes completeness truthful.
	_, err = db.Exec(`DELETE FROM atheros_search.graph_edges WHERE edge_id = 'missing'`)
	require.NoError(t, err)
	focused, err := svc.Graph(ctx, GraphFilters{RootBSSID: "10:20:30:40:50:60", Hops: 1})
	require.NoError(t, err)
	require.Len(t, focused.Nodes, 252)
	require.False(t, focused.Hierarchy.Truncated)
	assertClosedHierarchy(t, focused)
	for _, limit := range []int{1, 10} {
		capped, err := svc.Graph(ctx, GraphFilters{RootNodeID: focused.Hierarchy.RootID, Limit: limit})
		require.NoError(t, err)
		require.Len(t, capped.Nodes, limit)
		require.True(t, capped.Hierarchy.Truncated)
		require.Contains(t, capped.Hierarchy.Reason, "Node limit")
		require.Equal(t, 252, *capped.TotalNodeCount)
		assertClosedHierarchy(t, capped)
		foundRoot := false
		for _, node := range capped.Nodes {
			foundRoot = foundRoot || node.ID == focused.Hierarchy.RootID
		}
		require.True(t, foundRoot)
	}
	deviceRoot, err := svc.Graph(ctx, GraphFilters{Hierarchy: true, SourceMAC: "aa:bb:cc:dd:ee:01"})
	require.NoError(t, err)
	require.Equal(t, "device:aa:bb:cc:dd:ee:01", deviceRoot.Hierarchy.RootID)
	assertClosedHierarchy(t, deviceRoot)
	missing, err := svc.Graph(ctx, GraphFilters{RootNodeID: "ap:missing"})
	require.NoError(t, err)
	require.Empty(t, missing.Nodes)
	require.NotEmpty(t, missing.FocusReason)
	excluded, err := svc.Graph(ctx, GraphFilters{RootBSSID: "10:20:30:40:50:60", LocationIDs: []string{"outside"}})
	require.NoError(t, err)
	require.Empty(t, excluded.Nodes)
	// Ordinary pages may repeat endpoint nodes, but every individual page closes.
	pageFilters := GraphFilters{Scope: "all", PageSize: 7}
	for {
		page, err := svc.Graph(ctx, pageFilters)
		require.NoError(t, err)
		assertClosedGraph(t, page)
		if page.NextPageCursor == "" {
			break
		}
		pageFilters.PageCursor = page.NextPageCursor
	}
	_, err = db.Exec(`TRUNCATE atheros_search.graph_edges; DELETE FROM atheros_search.graph_nodes WHERE node_kind = 'access_point'`)
	require.NoError(t, err)
	orphans, err := svc.Graph(ctx, GraphFilters{Hierarchy: true})
	require.NoError(t, err)
	require.Len(t, orphans.Nodes, 251)
	require.Len(t, orphans.Hierarchy.RootIDs, 251)
	require.False(t, orphans.Hierarchy.Truncated)
	assertClosedHierarchy(t, orphans)
}

func TestReportingHierarchyIncludesDisconnectedApNeighborhoods(t *testing.T) {
	db := testdb.Provision(t)
	runtimeDB := testdb.Runtime(t)
	ctx := context.Background()
	_, err := db.Exec(`TRUNCATE atheros_search.graph_nodes, atheros_search.graph_edges, atheros_search.ap_catalog;
  INSERT INTO atheros_search.ap_catalog(bssid,authorized,first_observed_at,last_observed_at)
  VALUES ('10:20:30:40:50:60',true,'2026-09-01','2026-09-02'),
  ('10:20:30:40:50:61',false,'2026-09-01','2026-09-03');
  INSERT INTO atheros_search.graph_nodes(node_id,node_kind,normalized_mac,location_id,observed_at,projection_run_id)
  VALUES
  ('ap:10:20:30:40:50:60','access_point','10:20:30:40:50:60','lab','2026-09-02','test'),
  ('ap:10:20:30:40:50:61','access_point','10:20:30:40:50:61','lab','2026-09-03','test'),
  ('client:a','device','aa:bb:cc:dd:ee:01','lab','2026-09-02','test'),
  ('client:x','device','aa:bb:cc:dd:ee:02','lab','2026-09-03','test'),
  ('client:y','device','aa:bb:cc:dd:ee:03','lab','2026-09-03','test'),
  ('device:orphan','device','00:00:00:00:00:00','lab','2026-09-02','test');
  INSERT INTO atheros_search.graph_edges(edge_id,source_node_id,target_node_id,edge_kind,weight,projection_run_id)
  VALUES
  ('main-a','client:a','ap:10:20:30:40:50:60','observed_at',1,'test'),
  ('iso-x','client:x','ap:10:20:30:40:50:61','observed_at',1,'test'),
  ('iso-y','client:y','ap:10:20:30:40:50:61','observed_at',1,'test')`)
	require.NoError(t, err)
	svc := &Service{Pool: runtimeDB}
	result, err := svc.Graph(ctx, GraphFilters{Hierarchy: true, LocationIDs: []string{"lab"}})
	require.NoError(t, err)
	require.Equal(t, "ap:10:20:30:40:50:60", result.Hierarchy.RootID)
	require.Len(t, result.Nodes, 6)
	require.Equal(t, 6, *result.TotalNodeCount)
	require.ElementsMatch(t,
		[]string{"ap:10:20:30:40:50:60", "ap:10:20:30:40:50:61", "device:orphan"},
		result.Hierarchy.RootIDs)
	assertClosedHierarchy(t, result)
	// The cap selects walk nodes before disconnected neighborhoods; the response
	// then sorts the selected nodes by ID rather than selection priority.
	selectionIDs := []string{"ap:10:20:30:40:50:60", "client:a", "ap:10:20:30:40:50:61"}
	for _, limit := range []int{1, 2, 3} {
		capped, err := svc.Graph(ctx, GraphFilters{Hierarchy: true, LocationIDs: []string{"lab"}, Limit: limit})
		require.NoError(t, err)
		require.Len(t, capped.Nodes, limit)
		require.True(t, capped.Hierarchy.Truncated)
		require.Equal(t, 6, *capped.TotalNodeCount)
		selectedIDs := make([]string, 0, len(capped.Nodes))
		for _, node := range capped.Nodes {
			selectedIDs = append(selectedIDs, node.ID)
		}
		require.ElementsMatch(t, selectionIDs[:limit], selectedIDs, "node limit %d", limit)
		assertClosedHierarchy(t, capped)
	}
}

func assertClosedHierarchy(t *testing.T, result *GraphResponse) {
	t.Helper()
	assertClosedGraph(t, result)
	byID := map[string]GraphNode{}
	for _, node := range result.Nodes {
		byID[node.ID] = node
		require.NotNil(t, node.Depth)
	}
	for _, node := range result.Nodes {
		if node.ParentID != nil {
			require.Contains(t, byID, *node.ParentID)
			require.Equal(t, *byID[*node.ParentID].Depth+1, *node.Depth)
		}
	}
}

func assertClosedGraph(t *testing.T, result *GraphResponse) {
	t.Helper()
	ids := map[string]bool{}
	for _, node := range result.Nodes {
		ids[node.ID] = true
	}
	for _, edge := range result.Edges {
		require.True(t, ids[edge.Source], "missing source %s", edge.Source)
		require.True(t, ids[edge.Target], "missing target %s", edge.Target)
	}
}
