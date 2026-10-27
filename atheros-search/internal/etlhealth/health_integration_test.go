//go:build dbcontract

package etlhealth

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/testdb"
)

func TestDatabaseETLHealthUsesRuntimeColumnGrants(t *testing.T) {
	monitor := NewHealthMonitor(testdb.Runtime(t))
	monitor.SetCoverageModel("nomic-embed-text-v2-moe", "contract-input")
	snapshot, err := monitor.snapshotFromDB(t.Context())
	require.NoError(t, err)
	require.NotZero(t, snapshot.MeasuredAt)
	require.Len(t, snapshot.SourceCoverage, 2)
}

func TestDatabaseSourceCoverageMatchesRetrievalKindsAndCurrentVectors(t *testing.T) {
	provision := testdb.Provision(t)
	_, err := provision.ExecContext(t.Context(), `
TRUNCATE atheros_search.search_documents, atheros_search.embedding_jobs, atheros_search.embeddings;
INSERT INTO atheros_search.search_documents(document_id,source_id,source_key,source_table,source_kind,normalized_text,normalized_sha256,input_revision,observed_at)
SELECT md5(kind)::uuid,kind,kind,'synthetic',kind,'synthetic',encode(sha256(convert_to('synthetic','UTF8')),'hex'),'coverage-input',CURRENT_TIMESTAMP
FROM unnest(ARRAY['proxy_event','proxy_blocked_host_window','event','device','device_profile','ap_profile','identity_summary','observation_window']) AS kind;
INSERT INTO atheros_search.embeddings(document_id,embedding_kind,embedding_model,content_sha256,input_revision,embedding,embedded_at)
SELECT document_id,CASE WHEN source_kind IN ('proxy_event','proxy_blocked_host_window','event') THEN 'event'
 WHEN source_kind='observation_window' THEN 'behaviour' ELSE 'device' END,
 'coverage-model',normalized_sha256,input_revision,(ARRAY[1::real]||array_fill(0::real,ARRAY[767]))::public.vector,CURRENT_TIMESTAMP
FROM atheros_search.search_documents;
INSERT INTO atheros_search.embedding_jobs(job_id,document_id,embedding_kind,embedding_model,content_sha256,input_revision,status)
SELECT md5(document_id::text)::uuid,document_id,embedding_kind,embedding_model,content_sha256,input_revision,'completed' FROM atheros_search.embeddings;
UPDATE atheros_search.search_documents SET search_vector=to_tsvector('simple',normalized_text);
UPDATE atheros_search.search_documents SET search_vector=''::tsvector WHERE source_kind='device_profile';`)
	require.NoError(t, err)
	monitor := NewHealthMonitor(testdb.Runtime(t))
	monitor.SetCoverageModel("coverage-model", "coverage-input")
	coverage, err := monitor.sourceCoverage(t.Context())
	require.NoError(t, err)
	require.Equal(t, int64(2), coverage[0].Documents)
	require.Equal(t, int64(2), coverage[0].Vectors)
	require.Equal(t, int64(6), coverage[1].Documents)
	require.Equal(t, int64(6), coverage[1].Vectors)
	require.Equal(t, int64(5), coverage[1].LexicalDocuments, "empty tsvectors cannot establish lexical readiness")
	// Completed vectors with the wrong lane are not usable by dense retrieval.
	_, err = provision.ExecContext(t.Context(), `
UPDATE atheros_search.embeddings SET embedding_kind='event' WHERE document_id=md5('device_profile')::uuid;
UPDATE atheros_search.embedding_jobs SET embedding_kind='event' WHERE document_id=md5('device_profile')::uuid;
UPDATE atheros_search.embedding_jobs SET status='failed' WHERE document_id=md5('ap_profile')::uuid;
UPDATE atheros_search.embeddings SET input_revision='old-input' WHERE document_id=md5('identity_summary')::uuid;
UPDATE atheros_search.search_documents SET normalized_text='changed' WHERE document_id=md5('observation_window')::uuid;`)
	require.NoError(t, err)
	coverage, err = monitor.sourceCoverage(t.Context())
	require.NoError(t, err)
	require.Equal(t, int64(5), coverage[1].Documents, "changed text is not yet lexical evidence")
	require.Equal(t, int64(2), coverage[1].Vectors, "wrong kind, failed jobs and old revisions cannot establish coverage")
}
