//go:build dbcontract

package reporting

import (
	"context"
	"encoding/json"
	"sort"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/assets"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/testdb"
)

func TestReportingMissingAndExcludedFocus(t *testing.T) {
	db := testdb.Provision(t)
	runtimeDB := testdb.Runtime(t)
	ctx := context.Background()
	_, err := db.Exec(`TRUNCATE atheros_search.graph_nodes, atheros_search.graph_edges;
 INSERT INTO atheros_search.graph_nodes(node_id,node_kind,normalized_mac,location_id,projection_run_id)
 VALUES ('device:aa:bb:cc:dd:ee:ff','device','aa:bb:cc:dd:ee:ff','outside','test')`)
	require.NoError(t, err)
	for _, scope := range []string{"", "all"} {
		for _, mac := range []string{"aa:bb:cc:dd:ee:ff", "00:00:00:00:00:00"} {
			result, err := (&Service{Pool: runtimeDB}).Graph(ctx, GraphFilters{Scope: scope, SourceMAC: mac, LocationIDs: []string{"target"}})
			require.NoError(t, err)
			require.Empty(t, result.Nodes)
			require.Empty(t, result.Edges)
			require.NotEmpty(t, result.FocusReason)
		}
	}
}

func TestReportingPairDetailIndependentOfGraph(t *testing.T) {
	db := testdb.Provision(t)
	runtimeDB := testdb.Runtime(t)
	ctx := context.Background()
	_, err := db.Exec(`TRUNCATE atheros_search.merge_decisions, atheros_search.merge_candidates, atheros_search.devices CASCADE;
 INSERT INTO atheros_search.devices(mac,first_seen,last_seen) VALUES
 ('aa:bb:cc:dd:ee:ff',now()-interval '1 day',now()),('11:22:33:44:55:66',now()-interval '1 day',now());
 INSERT INTO atheros_search.merge_candidates(candidate_id,mac_a,mac_b,confidence,evidence,projection_run_id)
 VALUES('independent','aa:bb:cc:dd:ee:ff','11:22:33:44:55:66',0.8,'{"method":"fingerprint","conflicts":["owner"]}','run-test')`)
	require.NoError(t, err)
	detail, err := (&Service{Pool: runtimeDB}).PairDetail(ctx, "independent")
	require.NoError(t, err)
	require.Len(t, detail.Devices, 2)
	require.Contains(t, string(detail.Evidence), "fingerprint")
	_, err = (&assets.Service{Pool: runtimeDB}).MergeDecision(ctx, "independent", "needs_more_data", "test-operator")
	require.NoError(t, err)
	detail, err = (&Service{Pool: runtimeDB}).PairDetail(ctx, "independent")
	require.NoError(t, err)
	require.Equal(t, "needs_more_data", detail.Decision)
	require.Equal(t, "test-operator", detail.DecidedBy)
	_, err = (&assets.Service{Pool: runtimeDB}).MergeDecision(ctx, "independent", "merge", "test-operator")
	require.EqualError(t, err, "merge candidate already decided")
}

func TestReportingInventoryFilteredPagesAndSort(t *testing.T) {
	db := testdb.Provision(t)
	runtimeDB := testdb.Runtime(t)
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
		for {
			page, err := (&Service{Pool: runtimeDB}).Inventory(ctx, filters)
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
			_, err = (&Service{Pool: runtimeDB}).Inventory(ctx, changed)
			require.EqualError(t, err, "invalid page_cursor")
			changed = filters
			if sort == "identifier" {
				changed.Sort = "last_observed"
			} else {
				changed.Sort = "identifier"
			}
			_, err = (&Service{Pool: runtimeDB}).Inventory(ctx, changed)
			require.EqualError(t, err, "invalid page_cursor")
		}
		require.Len(t, seen, 60)
	}
	page, err := (&Service{Pool: runtimeDB}).Inventory(ctx, InventoryFilters{Scope: "page", NeedsIdentityReview: true, Query: "Identifier 2"})
	require.NoError(t, err)
	require.Equal(t, 1, *page.TotalDeviceCount)
	require.Equal(t, 2, *page.Nodes[0].PendingReviewCount)
}

func TestReportingSyntheticPageMeasurements(t *testing.T) {
	db := testdb.Provision(t)
	runtimeDB := testdb.Runtime(t)
	ctx := context.Background()
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
			return (&Service{Pool: runtimeDB}).Inventory(ctx, InventoryFilters{Scope: "page", PageSize: 50, LocationIDs: []string{"lab"}})
		}},
		{"AP-overview-50", func() (any, error) {
			return (&Service{Pool: runtimeDB}).Network(ctx, NetworkFilters{PageSize: 50, LocationIDs: []string{"lab"}})
		}},
		{"busy-roster-50", func() (any, error) {
			return (&Service{Pool: runtimeDB}).Network(ctx, NetworkFilters{PageSize: 50, APBSSID: "10:20:30:40:50:60", LocationIDs: []string{"lab"}})
		}},
		{"sparse-roster-50", func() (any, error) {
			return (&Service{Pool: runtimeDB}).Network(ctx, NetworkFilters{PageSize: 50, APBSSID: "10:20:30:40:51:01", LocationIDs: []string{"lab"}})
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
		t.Logf("SYNTHETIC %s: n=25, p50=%.2fms, p95=%.2fms, payload=%d bytes; 2000 registry MACs, 20100 event records, 21 APs", task.name, float64(samples[12])/float64(time.Millisecond), float64(samples[23])/float64(time.Millisecond), bytes)
	}
}
