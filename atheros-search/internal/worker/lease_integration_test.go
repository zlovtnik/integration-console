//go:build dbcontract

package worker

import (
	"database/sql"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/testdb"
)

func seedJobs(t *testing.T, count int) (*sql.DB, *sql.DB) {
	t.Helper()
	provision, runtimeDB := testdb.Provision(t), testdb.Runtime(t)
	_, err := provision.ExecContext(t.Context(), `TRUNCATE atheros_search.search_documents, atheros_search.embedding_jobs, atheros_search.embeddings, atheros_search.search_vectors_event, atheros_search.search_vectors_device, atheros_search.search_vectors_behaviour, atheros_search.search_vectors_sequence CASCADE`)
	require.NoError(t, err)
	for i := 0; i < count; i++ {
		id := fmt.Sprintf("00000000-0000-0000-0000-%012d", i+1)
		_, err = provision.ExecContext(t.Context(), `INSERT INTO atheros_search.search_documents(document_id,source_id,source_key,source_table,source_kind,normalized_text,normalized_sha256) VALUES($1,$2,$2,'wireless_frames','event','wireless', $3)`, id, id, strings.Repeat("a", 64))
		require.NoError(t, err)
		_, err = provision.ExecContext(t.Context(), `INSERT INTO atheros_search.embedding_jobs(job_id,document_id,embedding_kind,embedding_model,content_sha256) VALUES($1,$1,'event','test-model',$2)`, id, strings.Repeat("a", 64))
		require.NoError(t, err)
	}
	return provision, runtimeDB
}

func claimOne(t *testing.T, database *sql.DB, owner string) Job {
	t.Helper()
	tx, err := database.BeginTx(t.Context(), nil)
	require.NoError(t, err)
	jobs, err := claimJobs(t.Context(), tx, owner, 1, time.Now().Add(time.Minute))
	require.NoError(t, err)
	require.NoError(t, tx.Commit())
	require.Len(t, jobs, 1)
	return jobs[0]
}

func TestDatabaseClaimContentionSkipsLockedRows(t *testing.T) {
	_, database := seedJobs(t, 2)
	first, err := database.BeginTx(t.Context(), nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = first.Rollback() }) // Cleanup after assertion failure; Commit is checked below.
	jobs, err := claimJobs(t.Context(), first, "first", 1, time.Now().Add(time.Minute))
	require.NoError(t, err)
	require.Len(t, jobs, 1)
	second := claimOne(t, database, "second")
	require.NotEqual(t, jobs[0].JobID, second.JobID)
	require.NoError(t, first.Commit())
}

func TestDatabaseExpiredLeaseStaleFenceAndAtomicCompletion(t *testing.T) {
	provision, database := seedJobs(t, 1)
	old := claimOne(t, database, "old")
	_, err := provision.ExecContext(t.Context(), `UPDATE atheros_search.embedding_jobs SET lease_expires_at=now()-interval '1 second'`)
	require.NoError(t, err)
	recovered, err := recoverExpiredLeases(t.Context(), database, 10)
	require.NoError(t, err)
	require.EqualValues(t, 1, recovered)
	_, err = provision.ExecContext(t.Context(), `UPDATE atheros_search.embedding_jobs SET next_attempt_at=now()`)
	require.NoError(t, err)
	current := claimOne(t, database, "current")
	require.Greater(t, current.LeaseFence, old.LeaseFence)
	require.NotEqual(t, current.LeaseToken, old.LeaseToken)
	vector := make([]float32, 768)
	vector[0] = 1
	pool := &Pool{db: database}
	require.ErrorContains(t, pool.storeCompletion(t.Context(), old, vector), "lease lost")
	var count int
	require.NoError(t, database.QueryRowContext(t.Context(), `SELECT count(*) FROM atheros_search.embeddings`).Scan(&count))
	require.Zero(t, count)
	require.NoError(t, pool.storeCompletion(t.Context(), current, vector))
	var status string
	require.NoError(t, database.QueryRowContext(t.Context(), `SELECT status FROM atheros_search.embedding_jobs`).Scan(&status))
	require.Equal(t, "completed", status)
	require.NoError(t, database.QueryRowContext(t.Context(), `SELECT count(*) FROM atheros_search.search_vectors_event`).Scan(&count))
	require.Equal(t, 1, count)
}

func TestDatabaseRetriesExhaustAndAllEmbeddingKindsPersist(t *testing.T) {
	provision, database := seedJobs(t, 1)
	_, err := provision.ExecContext(t.Context(), `UPDATE atheros_search.embedding_jobs SET max_attempts=1`)
	require.NoError(t, err)
	job := claimOne(t, database, "worker")
	tx, err := database.BeginTx(t.Context(), nil)
	require.NoError(t, err)
	require.NoError(t, failJob(t.Context(), tx, job.JobID, job.LeaseToken, job.LeaseFence, "backend failure"))
	require.NoError(t, tx.Commit())
	var status string
	require.NoError(t, database.QueryRowContext(t.Context(), `SELECT status FROM atheros_search.embedding_jobs`).Scan(&status))
	require.Equal(t, "failed", status)
	vector := make([]float32, 768)
	vector[0] = 1
	for _, kind := range []string{"event", "device", "behaviour", "sequence"} {
		tx, err := database.BeginTx(t.Context(), nil)
		require.NoError(t, err)
		require.NoError(t, insertVector(t.Context(), tx, job.DocumentID, kind, "test-model", job.ContentSHA256, vector))
		require.NoError(t, tx.Commit())
	}
	var count int
	require.NoError(t, database.QueryRowContext(t.Context(), `SELECT count(*) FROM atheros_search.embeddings`).Scan(&count))
	require.Equal(t, 4, count)
}
