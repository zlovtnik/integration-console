//go:build dbcontract

package repair

import (
	"flag"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/testdb"
)

func TestDatabaseLegacyRetriesAreBoundedAndCannotReviveProxyJobs(t *testing.T) {
	provision, runtimeDB := testdb.Provision(t), testdb.Runtime(t)
	for _, operation := range []string{"retry-failed", "reset-stale"} {
		t.Run(operation, func(t *testing.T) {
			_, err := provision.ExecContext(t.Context(), `TRUNCATE atheros_search.search_documents,atheros_search.embedding_jobs;
 INSERT INTO atheros_search.search_documents(document_id,source_id,source_key,source_table,source_kind,normalized_text,normalized_sha256,status)
 SELECT lpad(i::text,32,'0')::uuid,i::text,i::text,'synthetic',CASE WHEN i=1 THEN 'proxy_event' ELSE 'event' END,'synthetic',repeat('a',64),CASE WHEN i=4 THEN 'superseded' ELSE 'active' END FROM generate_series(1,5)i;
 INSERT INTO atheros_search.embedding_jobs(job_id,document_id,embedding_kind,embedding_model,content_sha256,status,attempt_count)
 SELECT document_id,document_id,'event','contract',normalized_sha256,'failed',CASE WHEN source_id='5' THEN 5 ELSE 1 END FROM atheros_search.search_documents;`)
			require.NoError(t, err)
			if operation == "reset-stale" {
				_, err = provision.ExecContext(t.Context(), `UPDATE atheros_search.embedding_jobs SET status='leased',owner_id='synthetic-owner',lease_token=gen_random_uuid(),lease_expires_at=now()-interval '2 hours'`)
				require.NoError(t, err)
			}
			apply := func() {
				if operation == "retry-failed" {
					require.NoError(t, retryFailedJobs(t.Context(), runtimeDB, zerolog.Nop(), 1))
				} else {
					require.NoError(t, resetStaleJobs(t.Context(), runtimeDB, zerolog.Nop(), time.Hour, 1))
				}
			}
			apply()
			var count int
			require.NoError(t, runtimeDB.QueryRowContext(t.Context(), `SELECT count(*) FROM atheros_search.embedding_jobs WHERE status='pending'`).Scan(&count))
			require.Equal(t, 1, count)
			var proxyStatus string
			require.NoError(t, runtimeDB.QueryRowContext(t.Context(), `SELECT status FROM atheros_search.embedding_jobs WHERE job_id='00000000-0000-0000-0000-000000000001'`).Scan(&proxyStatus))
			if operation == "retry-failed" {
				require.Equal(t, "failed", proxyStatus)
			} else {
				require.Equal(t, "leased", proxyStatus)
			}
			apply()
			require.NoError(t, runtimeDB.QueryRowContext(t.Context(), `SELECT count(*) FROM atheros_search.embedding_jobs WHERE status='pending'`).Scan(&count))
			require.Equal(t, 2, count)
			apply()
			require.NoError(t, runtimeDB.QueryRowContext(t.Context(), `SELECT count(*) FROM atheros_search.embedding_jobs WHERE status='pending'`).Scan(&count))
			require.Equal(t, 2, count, "exhausted and superseded work stays terminal")
		})
	}
}

func TestDatabaseProxyRepairCLIDefaultLimit(t *testing.T) {
	t.Setenv("ATHSEARCH_POSTGRES_DSN", os.Getenv("ATHSEARCH_REPORT_TEST_DSN"))
	t.Setenv("ATHSEARCH_SCHEMA_MANIFEST_SHA256", os.Getenv("ATHSEARCH_TEST_MANIFEST_SHA256"))
	for _, key := range []string{"ATHSEARCH_POSTGRES_TLS_CA_FILE", "ATHSEARCH_POSTGRES_TLS_CERT_FILE", "ATHSEARCH_POSTGRES_TLS_KEY_FILE", "ATHSEARCH_POSTGRES_TLS_SERVER_NAME"} {
		t.Setenv(key, "")
	}
	for _, action := range []string{"proxy-status", "proxy-reconcile"} {
		t.Run(action, func(t *testing.T) {
			previousFlags, previousArgs := flag.CommandLine, os.Args
			t.Cleanup(func() { flag.CommandLine, os.Args = previousFlags, previousArgs })
			flag.CommandLine = flag.NewFlagSet("repair", flag.ContinueOnError)
			os.Args = []string{"repair", "-action", action, "-source-kinds", "proxy_event",
				"-model", "contract", "-input-revision", "legacy_unknown", "-created-before", "2000-01-01T00:00:00Z"}
			require.NoError(t, Run())
		})
	}
}

func TestDatabaseProxyRepairRetriesMatchingZeroVectorsAndKeepsValidVectors(t *testing.T) {
	provision, runtimeDB := testdb.Provision(t), testdb.Runtime(t)
	_, err := provision.ExecContext(t.Context(), `TRUNCATE atheros_search.search_documents,atheros_search.embedding_jobs,atheros_search.embeddings,atheros_search.search_vectors_event,atheros_search.embedding_repair_receipts,atheros_search.embedding_repair_progress;
      INSERT INTO atheros_search.search_documents(document_id,source_id,source_key,source_table,source_kind,normalized_text,normalized_sha256)
      SELECT lpad(i::text,32,'0')::uuid,i::text,i::text,'proxy_events','proxy_event','synthetic',encode(sha256(convert_to('synthetic','UTF8')),'hex') FROM generate_series(1,2)i;
      INSERT INTO atheros_search.embedding_jobs(job_id,document_id,embedding_kind,embedding_model,content_sha256,status,attempt_count)
      SELECT document_id,document_id,'event','contract',normalized_sha256,'completed',1 FROM atheros_search.search_documents;
      INSERT INTO atheros_search.embeddings(document_id,embedding_kind,embedding_model,content_sha256,embedding,embedded_at)
      SELECT document_id,'event','contract',normalized_sha256,array_fill(CASE WHEN source_id='1' THEN 0::real ELSE 1::real END,ARRAY[768])::public.vector,now() FROM atheros_search.search_documents;
      INSERT INTO atheros_search.search_vectors_event(document_id,embedding_model,content_sha256,embedding,embedded_at)
      SELECT document_id,embedding_model,content_sha256,embedding,embedded_at FROM atheros_search.embeddings;
      INSERT INTO atheros_search.proxy_preparation_policy(singleton,pending_high_water,expires_at)
      VALUES(TRUE,1000,now()+interval '1 hour') ON CONFLICT(singleton) DO UPDATE SET pending_high_water=1000,expires_at=EXCLUDED.expires_at`)
	require.NoError(t, err)
	scope := Scope{Kinds: []string{"proxy_event"}, Model: "contract", InputRevision: "legacy_unknown", Limit: 1, CampaignID: "zero-vector-campaign", CreatedBefore: time.Now()}
	preview, err := repairProxyPage(t.Context(), runtimeDB, scope, false)
	require.NoError(t, err)
	require.Equal(t, 1, preview.CompletedMissingVector)
	require.Zero(t, preview.Retried)
	applied, err := repairProxyPage(t.Context(), runtimeDB, scope, true)
	require.NoError(t, err)
	require.EqualValues(t, 1, applied.Retried)
	resumed, err := repairProxyPage(t.Context(), runtimeDB, scope, true)
	require.NoError(t, err)
	require.Equal(t, 1, resumed.Scanned)
	require.Zero(t, resumed.CompletedMissingVector)
	require.Zero(t, resumed.Retried)
	var status string
	require.NoError(t, runtimeDB.QueryRowContext(t.Context(), `SELECT status FROM atheros_search.embedding_jobs WHERE job_id='00000000-0000-0000-0000-000000000001'`).Scan(&status))
	require.Equal(t, "pending", status)
	require.NoError(t, runtimeDB.QueryRowContext(t.Context(), `SELECT status FROM atheros_search.embedding_jobs WHERE job_id='00000000-0000-0000-0000-000000000002'`).Scan(&status))
	require.Equal(t, "completed", status)
}

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
