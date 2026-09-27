package search

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/stretchr/testify/require"
	searchv1 "github.com/zlovtnik/ssl-proxy/services/atheros-search/proto/atheros/search/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// The repository Testcontainers runner supplies a newly provisioned database.
func reportingDB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := os.Getenv("ATHSEARCH_REPORT_TEST_DSN")
	if dsn == "" {
		t.Skip("run scripts/tests/test_atheros_reporting.py for PostgreSQL regressions")
	}
	db, err := sql.Open("pgx", dsn)
	require.NoError(t, err)
	t.Cleanup(func() { db.Close() })
	return db
}

func TestReportingScopedCandidatesBeyondGlobalBudget(t *testing.T) {
	db := reportingDB(t)
	ctx := context.Background()
	_, err := db.Exec(`TRUNCATE atheros_search.embeddings, atheros_search.search_documents CASCADE;
 INSERT INTO atheros_search.search_documents
 (document_id, source_id, source_key, source_table, source_kind, source_mac, location_id, sensor_id, observed_at, normalized_text, normalized_sha256, search_vector)
 SELECT md5(i::text)::uuid, 'scope-'||i, 'scope-'||i, 'wireless_frames', 'event',
 CASE WHEN i = 100 THEN 'aa:bb:cc:dd:ee:ff' ELSE '11:22:33:44:55:66' END,
 CASE WHEN i = 100 THEN 'target' ELSE 'outside' END, 'sensor-a',
 '2026-09-01'::timestamptz + i * interval '1 second',
 CASE WHEN i = 100 THEN 'needle' ELSE repeat('needle ', 20) END, repeat('a',64),
 to_tsvector('simple', CASE WHEN i = 100 THEN 'needle' ELSE repeat('needle ', 20) END)
 FROM generate_series(1,100) i;
 INSERT INTO atheros_search.embeddings(document_id, embedding_kind, embedding_model, content_sha256, embedded_at, embedding)
 SELECT document_id, 'event', 'scope-test', repeat('a',64), CURRENT_TIMESTAMP,
 (ARRAY[1::real, CASE WHEN source_id = 'scope-100' THEN 1::real ELSE 0::real END] || array_fill(0::real, ARRAY[766]))::public.vector
 FROM atheros_search.search_documents;`)
	require.NoError(t, err)
	qvec := make([]float32, 768)
	qvec[0] = 1
	scopes := []*searchv1.SearchFilters{
		{LocationIds: []string{"target"}}, {SourceMac: "aa:bb:cc:dd:ee:ff"},
		{ObservedAfter: timestamppb.New(time.Date(2026, 9, 1, 0, 1, 40, 0, time.UTC))},
	}
	for _, scope := range scopes {
		opts := Options{TopK: 1, OverfetchFactor: 1, Kinds: []string{"event"}, Filters: scope}
		dense, err := Dense(ctx, db, qvec, "scope-test", opts)
		require.NoError(t, err)
		require.Len(t, dense, 1)
		require.Equal(t, "scope-100", dense[0].SourceKey)
		for _, query := range []string{"needle", "*"} {
			sparse, err := Sparse(ctx, db, query, opts)
			require.NoError(t, err)
			require.Len(t, sparse, 1)
			require.Equal(t, "scope-100", sparse[0].SourceKey)
		}
	}
}

func TestReportingMissingAndExcludedFocus(t *testing.T) {
	db := reportingDB(t)
	ctx := context.Background()
	_, err := db.Exec(`TRUNCATE atheros_search.graph_nodes, atheros_search.graph_edges;
 INSERT INTO atheros_search.graph_nodes(node_id,node_kind,normalized_mac,location_id,projection_run_id)
 VALUES ('device:aa:bb:cc:dd:ee:ff','device','aa:bb:cc:dd:ee:ff','outside','test')`)
	require.NoError(t, err)
	for _, scope := range []string{"", "all"} {
		for _, mac := range []string{"aa:bb:cc:dd:ee:ff", "00:00:00:00:00:00"} {
			result, err := (&Service{Pool: db}).Graph(ctx, GraphFilters{Scope: scope, SourceMAC: mac, LocationIDs: []string{"target"}})
			require.NoError(t, err)
			require.Empty(t, result.Nodes)
			require.Empty(t, result.Edges)
			require.NotEmpty(t, result.FocusReason)
		}
	}
}

func TestReportingPairDetailIndependentOfGraph(t *testing.T) {
	db := reportingDB(t)
	ctx := context.Background()
	_, err := db.Exec(`TRUNCATE atheros_search.merge_decisions, atheros_search.merge_candidates, atheros_search.devices CASCADE;
 INSERT INTO atheros_search.devices(mac,first_seen,last_seen) VALUES
 ('aa:bb:cc:dd:ee:ff',now()-interval '1 day',now()),('11:22:33:44:55:66',now()-interval '1 day',now());
 INSERT INTO atheros_search.merge_candidates(candidate_id,mac_a,mac_b,confidence,evidence,projection_run_id)
 VALUES('independent','aa:bb:cc:dd:ee:ff','11:22:33:44:55:66',0.8,'{"method":"fingerprint","conflicts":["owner"]}','run-test')`)
	require.NoError(t, err)
	svc := &Service{Pool: db}
	detail, err := svc.PairDetail(ctx, "independent")
	require.NoError(t, err)
	require.Len(t, detail.Devices, 2)
	require.Contains(t, string(detail.Evidence), "fingerprint")
	nodes := map[string]InventoryNode{}
	edges := map[string]InventoryEdge{}
	for _, node := range detail.Devices {
		nodes[node.ID] = node
	}
	addSimilarityCandidate(nodes, edges, pendingInventoryCandidate{id: "independent", macA: detail.MACA, macB: detail.MACB, confidence: 0.8})
	found := false
	for _, edge := range edges {
		require.NotEqual(t, InventoryEdgeSameDevice, edge.Kind)
		if edge.Kind == InventoryEdgeCandidatePair {
			found = true
		}
	}
	require.True(t, found)
	_, err = svc.MergeDecision(ctx, "independent", "needs_more_data", "test-operator")
	require.NoError(t, err)
	detail, err = svc.PairDetail(ctx, "independent")
	require.NoError(t, err)
	require.Equal(t, "needs_more_data", detail.Decision)
	require.Equal(t, "test-operator", detail.DecidedBy)
	_, err = svc.MergeDecision(ctx, "independent", "merge", "test-operator")
	require.EqualError(t, err, "merge candidate already decided")
}

func TestReportingInventoryFilteredPagesAndSort(t *testing.T) {
	db := reportingDB(t)
	ctx := context.Background()
	_, err := db.Exec(`TRUNCATE atheros_search.devices, atheros_search.merge_candidates, atheros_search.merge_decisions CASCADE;
 INSERT INTO atheros_search.devices(mac,display_name,owner_id,registered,first_seen,last_seen)
 SELECT 'aa:bb:cc:dd:ee:'||lpad(to_hex(i),2,'0'),'Identifier '||i,
 CASE WHEN i%2=0 THEN 'owner-a' ELSE NULL END, i%2=0, '2026-09-01', '2026-09-02'
 FROM generate_series(1,120) i;
 INSERT INTO atheros_search.merge_candidates(candidate_id,mac_a,mac_b,projection_run_id)
 VALUES('review-a','aa:bb:cc:dd:ee:02','aa:bb:cc:dd:ee:04','test'),
 ('review-b','aa:bb:cc:dd:ee:02','aa:bb:cc:dd:ee:06','test')`)
	require.NoError(t, err)
	yes := true
	for _, sort := range []string{"last_observed", "identifier"} {
		filters := InventoryFilters{Scope: "page", PageSize: 7, Registered: &yes, OwnerIDs: []string{"owner-a"}, Sort: sort}
		seen := map[string]bool{}
		var previous string
		svc := &Service{Pool: db}
		for {
			page, err := svc.Inventory(ctx, filters)
			require.NoError(t, err)
			require.Equal(t, 60, *page.TotalDeviceCount)
			require.Equal(t, 60, page.TotalRegisteredCount)
			require.LessOrEqual(t, len(page.Nodes), 7)
			for _, node := range page.Nodes {
				require.False(t, seen[node.MAC])
				require.Greater(t, node.MAC, previous)
				previous = node.MAC
				seen[node.MAC] = true
				require.True(t, *node.Registered)
			}
			if page.NextPageCursor == "" {
				break
			}
			filters.PageCursor = page.NextPageCursor
			changed := filters
			changed.Query = "different"
			_, err = svc.Inventory(ctx, changed)
			require.EqualError(t, err, "invalid page_cursor")
			changed = filters
			if sort == "identifier" {
				changed.Sort = "last_observed"
			} else {
				changed.Sort = "identifier"
			}
			_, err = svc.Inventory(ctx, changed)
			require.EqualError(t, err, "invalid page_cursor")
		}
		require.Len(t, seen, 60)
	}
	page, err := (&Service{Pool: db}).Inventory(ctx, InventoryFilters{Scope: "page", NeedsIdentityReview: true, Query: "Identifier 2"})
	require.NoError(t, err)
	require.Equal(t, 1, *page.TotalDeviceCount)
	require.Equal(t, 2, *page.Nodes[0].PendingReviewCount)
}

func TestReportingNetworkDistinctRosterAndSearchAgreement(t *testing.T) {
	db := reportingDB(t)
	ctx := context.Background()
	_, err := db.Exec(`TRUNCATE atheros_search.search_documents CASCADE;
 INSERT INTO atheros_search.search_documents(document_id,source_id,source_key,source_table,source_kind,source_mac,bssid,ssid,location_id,sensor_id,observed_at,normalized_text,normalized_sha256,search_vector)
 SELECT md5(('network-'||i)::text)::uuid,'network-'||i,'network-'||i,'wireless_frames','event',
 'aa:bb:cc:dd:ee:'||lpad(to_hex(((i-1)%120)+1),2,'0'),'10:20:30:40:50:60','Test AP','lab','sensor-a','2026-09-02', 'wireless',repeat('a',64),to_tsvector('simple','wireless') FROM generate_series(1,240)i;
 INSERT INTO atheros_search.search_documents(document_id,source_id,source_key,source_table,source_kind,source_mac,bssid,location_id,sensor_id,observed_at,normalized_text,normalized_sha256,search_vector)
 SELECT md5(('extra-'||i)::text)::uuid,'extra-'||i,'extra-'||i,'wireless_frames','event',
 CASE i WHEN 1 THEN '10:20:30:40:50:60' WHEN 2 THEN 'ff:ff:ff:ff:ff:ff' ELSE 'aa:bb:cc:dd:ee:01' END,
 CASE i WHEN 3 THEN '10:20:30:40:50:61' ELSE '10:20:30:40:50:60' END,
 'lab','sensor-a','2026-09-02','wireless',repeat('a',64),to_tsvector('simple','wireless') FROM generate_series(1,3)i;`)
	require.NoError(t, err)
	svc := &Service{Pool: db}
	filters := NetworkFilters{LocationIDs: []string{"lab"}, SensorIDs: []string{"sensor-a"}, PageSize: 1}
	overview, err := svc.Network(ctx, filters)
	require.NoError(t, err)
	require.Len(t, overview.AccessPoints, 1)
	require.Equal(t, 120, overview.AccessPoints[0].IdentifierCount)
	require.NotEmpty(t, overview.NextPageCursor)
	filters.PageCursor = overview.NextPageCursor
	overview, err = svc.Network(ctx, filters)
	require.NoError(t, err)
	require.Equal(t, 1, overview.AccessPoints[0].IdentifierCount)
	filters.PageCursor = ""
	filters.APBSSID = "10:20:30:40:50:60"
	filters.PageSize = 11
	seen := map[string]bool{}
	for {
		roster, err := svc.Network(ctx, filters)
		require.NoError(t, err)
		require.Equal(t, 120, roster.TotalRows)
		require.LessOrEqual(t, len(roster.Nodes), 12)
		require.Equal(t, len(roster.Roster), len(roster.Edges))
		for _, member := range roster.Roster {
			require.False(t, seen[member.MAC])
			seen[member.MAC] = true
			require.Equal(t, 2, member.RecordCount)
		}
		if roster.NextPageCursor == "" {
			break
		}
		filters.PageCursor = roster.NextPageCursor
	}
	require.Len(t, seen, 120)
	sparse, err := Sparse(ctx, db, "*", Options{TopK: 300, Kinds: []string{"event"}, Filters: &searchv1.SearchFilters{LocationIds: []string{"lab"}, SensorIds: []string{"sensor-a"}, Bssid: filters.APBSSID, ObservedApContextOnly: true}})
	require.NoError(t, err)
	searchMACs := map[string]bool{}
	for _, record := range sparse {
		searchMACs[record.SourceMAC] = true
	}
	require.Equal(t, seen, searchMACs)
	_, err = db.Exec(`TRUNCATE atheros_search.graph_edges, atheros_search.graph_nodes;
 INSERT INTO atheros_search.graph_nodes(node_id,node_kind,label,normalized_mac,projection_run_id)
 VALUES('device:aa:bb:cc:dd:ee:01','device','Observed identifier','aa:bb:cc:dd:ee:01','test'),
 ('cluster:confirmed','identity_cluster','Confirmed identity cluster',NULL,'test');
 INSERT INTO atheros_search.graph_edges(edge_id,source_node_id,target_node_id,edge_kind,weight,weight_basis,projection_run_id)
 VALUES('membership:confirmed','device:aa:bb:cc:dd:ee:01','cluster:confirmed','identity_member',0.9,'cluster_confidence','test')`)
	require.NoError(t, err)
	filters.PageCursor = ""
	filters.IncludeHints = true
	withHints, err := svc.Network(ctx, filters)
	require.NoError(t, err)
	require.Equal(t, 120, withHints.TotalRows)
	require.Len(t, withHints.Roster, 11)
	require.Len(t, withHints.Nodes, 13)
	require.Contains(t, withHints.Nodes, GraphNode{ID: "cluster:confirmed", Kind: "cluster", Label: "Confirmed identity cluster"})
	var clusterEdge bool
	for _, edge := range withHints.Edges {
		if edge.Kind == "cluster_member" {
			clusterEdge = true
			require.Equal(t, "cluster_confidence", edge.WeightBasis)
		}
	}
	require.True(t, clusterEdge)
	filters.IncludeHints = false
	filters.PageCursor = ""
	filters.SensorIDs = []string{"missing"}
	empty, err := svc.Network(ctx, filters)
	require.NoError(t, err)
	require.Empty(t, empty.Nodes)
	require.NotEmpty(t, empty.FocusReason)
}

func TestReportingSyntheticPageMeasurements(t *testing.T) {
	db := reportingDB(t)
	ctx := context.Background()
	svc := &Service{Pool: db}
	_, err := db.Exec(`TRUNCATE atheros_search.search_documents, atheros_search.devices, atheros_search.merge_candidates, atheros_search.merge_decisions CASCADE;
 INSERT INTO atheros_search.devices(mac,display_name,location_id,registered,first_seen,last_seen)
 SELECT 'aa:bb:cc:dd:'||substr(lpad(to_hex(i),4,'0'),1,2)||':'||substr(lpad(to_hex(i),4,'0'),3,2),
 'Synthetic identifier '||i,'lab',i%2=0,'2026-09-01','2026-09-02' FROM generate_series(1,2000)i;
 INSERT INTO atheros_search.search_documents(document_id,source_id,source_key,source_table,source_kind,source_mac,bssid,ssid,location_id,sensor_id,observed_at,normalized_text,normalized_sha256,search_vector)
 SELECT md5(('measure-'||i)::text)::uuid,'measure-'||i,'measure-'||i,'wireless_frames','event',
 'aa:bb:cc:dd:'||substr(lpad(to_hex(((i-1)%2000)+1),4,'0'),1,2)||':'||substr(lpad(to_hex(((i-1)%2000)+1),4,'0'),3,2),
 '10:20:30:40:50:60','Busy AP','lab','sensor-a','2026-09-02','wireless',repeat('a',64),to_tsvector('simple','wireless') FROM generate_series(1,20000)i;
 INSERT INTO atheros_search.search_documents(document_id,source_id,source_key,source_table,source_kind,source_mac,bssid,ssid,location_id,sensor_id,observed_at,normalized_text,normalized_sha256,search_vector)
 SELECT md5(('sparse-'||i)::text)::uuid,'sparse-'||i,'sparse-'||i,'wireless_frames','event',
 'aa:bb:cc:dd:00:'||lpad(to_hex(((i-1)%5)+1),2,'0'),
 '10:20:30:40:51:'||lpad(to_hex(((i-1)/5)+1),2,'0'),'Sparse AP','lab','sensor-a','2026-09-02','wireless',repeat('a',64),to_tsvector('simple','wireless') FROM generate_series(1,100)i;
 ANALYZE atheros_search.search_documents; ANALYZE atheros_search.devices;`)
	require.NoError(t, err)
	tasks := []struct {
		name string
		load func() (any, error)
	}{
		{"inventory-50", func() (any, error) {
			return svc.Inventory(ctx, InventoryFilters{Scope: "page", PageSize: 50, LocationIDs: []string{"lab"}})
		}},
		{"AP-overview-50", func() (any, error) {
			return svc.Network(ctx, NetworkFilters{PageSize: 50, LocationIDs: []string{"lab"}})
		}},
		{"busy-roster-50", func() (any, error) {
			return svc.Network(ctx, NetworkFilters{PageSize: 50, APBSSID: "10:20:30:40:50:60", LocationIDs: []string{"lab"}})
		}},
		{"sparse-roster-50", func() (any, error) {
			return svc.Network(ctx, NetworkFilters{PageSize: 50, APBSSID: "10:20:30:40:51:01", LocationIDs: []string{"lab"}})
		}},
	}
	for _, task := range tasks {
		_, err := task.load()
		require.NoError(t, err)
		samples := []time.Duration{}
		bytes := 0
		for sample := 0; sample < 25; sample++ {
			start := time.Now()
			response, err := task.load()
			require.NoError(t, err)
			payload, err := json.Marshal(response)
			require.NoError(t, err)
			samples = append(samples, time.Since(start))
			bytes = len(payload)
		}
		sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
		t.Log(fmt.Sprintf("SYNTHETIC %s: n=25, p50=%.2fms, p95=%.2fms, payload=%d bytes; 2000 registry MACs, 20100 event records, 21 APs", task.name, float64(samples[12])/float64(time.Millisecond), float64(samples[23])/float64(time.Millisecond), bytes))
	}
}
