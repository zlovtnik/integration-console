//go:build dbcontract

package search

import (
	"context"
	"testing"
	"time"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/testdb"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/reporting"
	searchv1 "github.com/zlovtnik/ssl-proxy/services/atheros-search/proto/atheros/search/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// The repository Testcontainers runner supplies a newly provisioned database.

func TestReportingProxyDenseUsesCurrentInputAndSubstringHostBeforeBudget(t *testing.T) {
	provision, runtimeDB := testdb.Provision(t), testdb.Runtime(t)
	_, err := provision.ExecContext(t.Context(), `TRUNCATE atheros_search.search_documents,atheros_search.embeddings;
 INSERT INTO atheros_search.search_documents(document_id,source_id,source_key,source_table,source_kind,host,normalized_text,normalized_sha256,input_revision)
 SELECT lpad(i::text,32,'0')::uuid,i::text,i::text,'proxy_events',CASE WHEN i=7 THEN 'proxy_blocked_host_window' WHEN i=8 THEN 'event' ELSE 'proxy_event' END,
 CASE WHEN i=1 THEN 'outside.example' ELSE 'API.Example.COM' END,'synthetic',encode(sha256(convert_to('synthetic','UTF8')),'hex'),'current-input' FROM generate_series(1,8)i;
 INSERT INTO atheros_search.embeddings(document_id,embedding_kind,embedding_model,content_sha256,input_revision,embedding,embedded_at)
 SELECT document_id,'event','dense-contract',CASE source_id WHEN '3' THEN repeat('a',64) ELSE normalized_sha256 END,
 CASE source_id WHEN '4' THEN 'old-input' ELSE input_revision END,
 (ARRAY[1::real,CASE source_id WHEN '6' THEN 1::real ELSE 0::real END]||array_fill(0::real,ARRAY[766]))::public.vector,now() FROM atheros_search.search_documents;
 UPDATE atheros_search.search_documents SET normalized_text='tampered' WHERE source_id='2';
 UPDATE atheros_search.search_documents SET input_revision='old-input' WHERE source_id='5';`)
	require.NoError(t, err)
	vector := make([]float32, 768)
	vector[0] = 1
	for _, item := range []struct{ kind, source string }{{"proxy_event", "6"}, {"proxy_blocked_host_window", "7"}} {
		results, err := Dense(t.Context(), runtimeDB, vector, "dense-contract", Options{
			TopK: 1, OverfetchFactor: 1, Kinds: []string{item.kind}, InputRevision: "current-input",
			Filters: &searchv1.SearchFilters{Host: "example.c"},
		})
		require.NoError(t, err)
		require.Len(t, results, 1)
		require.Equal(t, item.source, results[0].SourceKey)
	}
}

func TestReportingScopedCandidatesBeyondGlobalBudget(t *testing.T) {
	db := testdb.Provision(t)
	runtimeDB := testdb.Runtime(t)
	ctx := context.Background()
	_, err := db.Exec(`TRUNCATE atheros_search.embeddings, atheros_search.search_documents CASCADE;
 INSERT INTO atheros_search.search_documents
 (document_id, source_id, source_key, source_table, source_kind, source_mac, location_id, sensor_id, observed_at, normalized_text, normalized_sha256, search_vector)
 SELECT md5(i::text)::uuid, 'scope-'||i, 'scope-'||i, 'wireless_frames', 'event',
 CASE WHEN i = 100 THEN 'aa:bb:cc:dd:ee:ff' ELSE '11:22:33:44:55:66' END,
 CASE WHEN i = 100 THEN 'target' ELSE 'outside' END, 'sensor-a',
 '2026-09-01'::timestamptz + i * interval '1 second',
 CASE WHEN i = 100 THEN 'needle' ELSE repeat('needle ', 20) END,
 encode(sha256(convert_to(CASE WHEN i = 100 THEN 'needle' ELSE repeat('needle ', 20) END,'UTF8')),'hex'),
 to_tsvector('simple', CASE WHEN i = 100 THEN 'needle' ELSE repeat('needle ', 20) END)
 FROM generate_series(1,100) i;
 INSERT INTO atheros_search.embeddings(document_id, embedding_kind, embedding_model, content_sha256, embedded_at, embedding)
 SELECT document_id, 'event', 'scope-test', normalized_sha256, CURRENT_TIMESTAMP,
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
		dense, err := Dense(ctx, runtimeDB, qvec, "scope-test", opts)
		require.NoError(t, err)
		require.Len(t, dense, 1)
		require.Equal(t, "scope-100", dense[0].SourceKey)
		for _, query := range []string{"needle", "*"} {
			sparse, err := Sparse(ctx, runtimeDB, query, opts)
			require.NoError(t, err)
			require.Len(t, sparse, 1)
			require.Equal(t, "scope-100", sparse[0].SourceKey)
		}
	}
}

func TestReportingNetworkDistinctRosterAndSearchAgreement(t *testing.T) {
	db := testdb.Provision(t)
	runtimeDB := testdb.Runtime(t)
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
	filters := reporting.NetworkFilters{LocationIDs: []string{"lab"}, SensorIDs: []string{"sensor-a"}, PageSize: 1}
	overview, err := (&reporting.Service{Pool: runtimeDB}).Network(ctx, filters)
	require.NoError(t, err)
	require.Len(t, overview.AccessPoints, 1)
	require.Equal(t, 120, overview.AccessPoints[0].IdentifierCount)
	require.NotEmpty(t, overview.NextPageCursor)
	filters.PageCursor = overview.NextPageCursor
	overview, err = (&reporting.Service{Pool: runtimeDB}).Network(ctx, filters)
	require.NoError(t, err)
	require.Equal(t, 1, overview.AccessPoints[0].IdentifierCount)
	filters.PageCursor = ""
	filters.APBSSID = "10:20:30:40:50:60"
	filters.PageSize = 11
	seen := map[string]bool{}
	for {
		roster, err := (&reporting.Service{Pool: runtimeDB}).Network(ctx, filters)
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
	sparse, err := Sparse(ctx, runtimeDB, "*", Options{TopK: 300, Kinds: []string{"event"}, Filters: &searchv1.SearchFilters{LocationIds: []string{"lab"}, SensorIds: []string{"sensor-a"}, Bssid: filters.APBSSID, ObservedApContextOnly: true}})
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
	withHints, err := (&reporting.Service{Pool: runtimeDB}).Network(ctx, filters)
	require.NoError(t, err)
	require.Equal(t, 120, withHints.TotalRows)
	require.Len(t, withHints.Roster, 11)
	require.Len(t, withHints.Nodes, 13)
	require.Contains(t, withHints.Nodes, reporting.GraphNode{ID: "cluster:confirmed", Kind: "cluster", Label: "Confirmed identity cluster"})
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
	empty, err := (&reporting.Service{Pool: runtimeDB}).Network(ctx, filters)
	require.NoError(t, err)
	require.Empty(t, empty.Nodes)
	require.NotEmpty(t, empty.FocusReason)
}
