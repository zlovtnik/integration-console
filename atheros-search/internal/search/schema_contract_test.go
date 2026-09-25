package search

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCanonicalPostgresSchemaMatchesQueryFacade(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	require.True(t, ok)
	root := filepath.Clean(filepath.Join(filepath.Dir(currentFile), "../../../../.."))
	files := []string{
		"sql/postgres/atheros_search/01_tables/001_schema_manifest.sql",
		"sql/postgres/atheros_search/01_tables/002_search_documents.sql",
		"sql/postgres/atheros_search/01_tables/003_search_vectors.sql",
		"sql/postgres/atheros_search/01_tables/006_query_feedback.sql",
		"sql/postgres/atheros_search/01_tables/009_embedding_recovery_contract.sql",
		"sql/postgres/atheros_search/01_tables/011_identity_graph.sql",
		"sql/postgres/atheros_search/01_tables/015_graph_edge_weight_basis.sql",
	}
	combined := ""
	for _, relative := range files {
		body, err := os.ReadFile(filepath.Join(root, relative))
		require.NoError(t, err, relative)
		combined += string(body)
	}
	for _, required := range []string{
		"CREATE TABLE IF NOT EXISTS atheros_search.schema_readiness",
		"CREATE TABLE IF NOT EXISTS atheros_search.search_documents",
		"CREATE TABLE IF NOT EXISTS atheros_search.embedding_jobs",
		"CREATE TABLE IF NOT EXISTS atheros_search.devices",
		"CREATE TABLE IF NOT EXISTS atheros_search.embeddings",
		"CREATE TABLE IF NOT EXISTS atheros_search.search_queries",
		"CREATE TABLE IF NOT EXISTS atheros_search.worker_heartbeat",
		"embedding       VECTOR(768) NOT NULL",
		"embedding_kind IN ('event', 'device', 'behaviour', 'sequence')",
		"search_vectors_behaviour",
		"search_vectors_sequence",
		"public.vector",
		"CREATE TABLE IF NOT EXISTS atheros_search.graph_nodes",
		"CREATE TABLE IF NOT EXISTS atheros_search.graph_edges",
		"graph_edges_source_idx ON atheros_search.graph_edges (source_node_id, edge_kind)",
		"graph_edges_target_idx ON atheros_search.graph_edges (target_node_id, edge_kind)",
		"ADD COLUMN IF NOT EXISTS weight_basis",
	} {
		require.Contains(t, combined, required)
	}
}

func TestCanonicalSchemaCoversEverySearchableEmbeddingKind(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	require.True(t, ok)
	root := filepath.Clean(filepath.Join(filepath.Dir(currentFile), "../../../../.."))
	body, err := os.ReadFile(filepath.Join(root, "sql/postgres/atheros_search/01_tables/009_embedding_recovery_contract.sql"))
	require.NoError(t, err)
	schema := string(body)
	for kind, table := range map[string]string{
		"event":     "search_vectors_event",
		"device":    "search_vectors_device",
		"behaviour": "search_vectors_behaviour",
		"sequence":  "search_vectors_sequence",
	} {
		require.Contains(t, schema, "CREATE TABLE IF NOT EXISTS atheros_search."+table,
			"embedding kind %q has no per-kind vector table", kind)
	}
}
