//go:build dbcontract

package repair

import (
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/testdb"
)

func TestDatabaseProxyRepairIsBoundedScopedResumableAndKeepsDiagnostics(t *testing.T) {
	provision, runtimeDB := testdb.Provision(t), testdb.Runtime(t)
	_, err := provision.ExecContext(t.Context(), `TRUNCATE atheros_search.search_documents,atheros_search.embedding_jobs,atheros_search.embeddings,atheros_search.search_vectors_event,atheros_search.embedding_repair_receipts,atheros_search.embedding_repair_progress;
      INSERT INTO atheros_search.search_documents(document_id,source_id,source_key,source_table,source_kind,normalized_text,normalized_sha256)
      SELECT md5(i::text)::uuid,i::text,i::text,'proxy_events',CASE WHEN i=3 THEN 'event' ELSE 'proxy_event' END,'synthetic',encode(sha256(convert_to('synthetic','UTF8')),'hex') FROM generate_series(1,3)i;
      INSERT INTO atheros_search.embedding_jobs(job_id,document_id,embedding_kind,embedding_model,content_sha256,status,attempt_count,last_error)
      SELECT document_id,document_id,'event','contract',normalized_sha256,'completed',1,'retained diagnostic' FROM atheros_search.search_documents;`)
	require.NoError(t, err)
	scope := Scope{Kinds: []string{"proxy_event", "proxy_blocked_host_window"}, Model: "contract", InputRevision: "legacy_unknown", Limit: 1, CampaignID: "contract-campaign", CreatedBefore: time.Now()}
	_, err = provision.ExecContext(t.Context(), `INSERT INTO atheros_search.proxy_preparation_policy(singleton,pending_high_water,expires_at)
      VALUES(TRUE,1000,now()+interval '1 hour') ON CONFLICT(singleton) DO UPDATE SET pending_high_water=1000,expires_at=EXCLUDED.expires_at`)
	require.NoError(t, err)
	preview, err := repairProxyPage(t.Context(), runtimeDB, scope, false)
	require.NoError(t, err)
	require.Equal(t, 1, preview.CompletedMissingVector)
	require.Zero(t, preview.Retried)
	applied, err := repairProxyPage(t.Context(), runtimeDB, scope, true)
	require.NoError(t, err)
	require.EqualValues(t, 1, applied.Retried)
	require.Equal(t, preview.AfterJobID, applied.AfterJobID)
	resumed, err := repairProxyPage(t.Context(), runtimeDB, scope, true)
	require.NoError(t, err)
	require.EqualValues(t, 1, resumed.Retried)
	require.NotEqual(t, applied.AfterJobID, resumed.AfterJobID)
	exhausted, err := repairProxyPage(t.Context(), runtimeDB, scope, true)
	require.NoError(t, err)
	require.Zero(t, exhausted.Scanned)
	var receipts, wirelessCompleted int
	require.NoError(t, runtimeDB.QueryRowContext(t.Context(), `SELECT count(*) FROM atheros_search.embedding_repair_receipts WHERE previous_error='retained diagnostic' AND attempt_count=1`).Scan(&receipts))
	require.Equal(t, 2, receipts)
	require.NoError(t, runtimeDB.QueryRowContext(t.Context(), `SELECT count(*) FROM atheros_search.embedding_jobs job JOIN atheros_search.search_documents doc USING(document_id) WHERE doc.source_kind='event' AND job.status='completed'`).Scan(&wirelessCompleted))
	require.Equal(t, 1, wirelessCompleted)
	scope.Model = "different-scope"
	_, err = repairProxyPage(t.Context(), runtimeDB, scope, true)
	require.ErrorContains(t, err, "scope or cursor mismatch")
}

func TestDatabaseSupersededRepairLeavesActiveJobsAndHonorsDryRun(t *testing.T) {
	provision, runtimeDB := testdb.Provision(t), testdb.Runtime(t)
	_, err := provision.ExecContext(t.Context(), `TRUNCATE atheros_search.search_documents, atheros_search.embedding_jobs CASCADE`)
	require.NoError(t, err)
	for _, item := range []struct{ id, status string }{
		{"00000000-0000-0000-0000-000000000001", "superseded"},
		{"00000000-0000-0000-0000-000000000002", "active"},
		{"00000000-0000-0000-0000-000000000003", "deleted"},
	} {
		_, err = provision.ExecContext(t.Context(), `INSERT INTO atheros_search.search_documents(document_id,source_id,source_key,source_kind,source_table,normalized_text,normalized_sha256,status) VALUES($1::uuid,$1::text,$1::text,'event','wireless_frames','synthetic',$2,$3)`, item.id, strings.Repeat("a", 64), item.status)
		require.NoError(t, err)
		_, err = provision.ExecContext(t.Context(), `INSERT INTO atheros_search.embedding_jobs(job_id,document_id,embedding_kind,embedding_model,content_sha256) VALUES($1,$1,'event','contract',$2)`, item.id, strings.Repeat("a", 64))
		require.NoError(t, err)
	}
	require.NoError(t, cancelSupersededJobs(t.Context(), runtimeDB, zerolog.Nop(), 10, true))
	var count int
	require.NoError(t, runtimeDB.QueryRowContext(t.Context(), `SELECT count(*) FROM atheros_search.embedding_jobs WHERE status='pending'`).Scan(&count))
	require.Equal(t, 3, count)
	require.NoError(t, cancelSupersededJobs(t.Context(), runtimeDB, zerolog.Nop(), 10, false))
	for _, id := range []string{"00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000003"} {
		var status string
		require.NoError(t, runtimeDB.QueryRowContext(t.Context(), `SELECT status FROM atheros_search.embedding_jobs WHERE job_id=$1`, id).Scan(&status))
		require.Equal(t, "cancelled", status)
	}
	var activeStatus string
	require.NoError(t, runtimeDB.QueryRowContext(t.Context(), `SELECT status FROM atheros_search.embedding_jobs WHERE job_id='00000000-0000-0000-0000-000000000002'`).Scan(&activeStatus))
	require.Equal(t, "pending", activeStatus)
	require.NoError(t, runtimeDB.QueryRowContext(t.Context(), `SELECT count(*) FROM atheros_search.embedding_jobs WHERE status='pending'`).Scan(&count))
	require.Equal(t, 1, count)
}

func TestDatabaseOrphanedRepairCancelsMissingDocumentJobsAndHonorsDryRun(t *testing.T) {
	provision, runtimeDB := testdb.Provision(t), testdb.Runtime(t)
	_, err := provision.ExecContext(t.Context(), `TRUNCATE atheros_search.search_documents, atheros_search.embedding_jobs CASCADE`)
	require.NoError(t, err)
	orphanID := "00000000-0000-0000-0000-000000000001"
	linkedID := "00000000-0000-0000-0000-000000000002"
	_, err = provision.ExecContext(t.Context(), `INSERT INTO atheros_search.embedding_jobs(job_id,document_id,embedding_kind,embedding_model,content_sha256) VALUES($1,$1,'event','contract',$2)`, orphanID, strings.Repeat("a", 64))
	require.NoError(t, err)
	_, err = provision.ExecContext(t.Context(), `INSERT INTO atheros_search.search_documents(document_id,source_id,source_key,source_kind,source_table,normalized_text,normalized_sha256) VALUES($1::uuid,$1::text,$1::text,'event','wireless_frames','synthetic',$2)`, linkedID, strings.Repeat("a", 64))
	require.NoError(t, err)
	_, err = provision.ExecContext(t.Context(), `INSERT INTO atheros_search.embedding_jobs(job_id,document_id,embedding_kind,embedding_model,content_sha256) VALUES($1,$1,'event','contract',$2)`, linkedID, strings.Repeat("a", 64))
	require.NoError(t, err)

	require.NoError(t, cancelOrphanedJobs(t.Context(), runtimeDB, zerolog.Nop(), 10, true))
	var count int
	require.NoError(t, runtimeDB.QueryRowContext(t.Context(), `SELECT count(*) FROM atheros_search.embedding_jobs WHERE status='pending'`).Scan(&count))
	require.Equal(t, 2, count)

	require.NoError(t, cancelOrphanedJobs(t.Context(), runtimeDB, zerolog.Nop(), 10, false))
	var status, lastError string
	require.NoError(t, runtimeDB.QueryRowContext(t.Context(), `SELECT status, last_error FROM atheros_search.embedding_jobs WHERE job_id=$1`, orphanID).Scan(&status, &lastError))
	require.Equal(t, "cancelled", status)
	require.Contains(t, lastError, "document missing")
	require.NoError(t, runtimeDB.QueryRowContext(t.Context(), `SELECT status FROM atheros_search.embedding_jobs WHERE job_id=$1`, linkedID).Scan(&status))
	require.Equal(t, "pending", status)
}
