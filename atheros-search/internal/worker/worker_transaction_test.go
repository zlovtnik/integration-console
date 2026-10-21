package worker

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/embed"
)

type checkingEmbedder struct {
	t       *testing.T
	dbPing  func(context.Context) error
	vectors [][]float32
}

func (e checkingEmbedder) Embed(ctx context.Context, texts []string, kind string) ([][]float32, error) {
	e.t.Helper()
	require.Equal(e.t, []string{"normalized wireless event"}, texts)
	require.Equal(e.t, "event", kind)
	require.NoError(e.t, e.dbPing(ctx), "claim transaction must commit before embedding I/O")
	return e.vectors, nil
}

func TestProcessBatchCommitsClaimBeforeEmbeddingAndCompletesAtomically(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	job := testJob()
	mock.ExpectBegin()
	mock.ExpectQuery("UPDATE atheros_search\\.embedding_jobs").
		WithArgs("worker-1", sqlmock.AnyArg(), 1, "null", "", "legacy_unknown").
		WillReturnRows(sqlmock.NewRows([]string{
			"job_id", "document_id", "embedding_kind", "embedding_model",
			"content_sha256", "priority", "lease_token", "lease_fence", "input_revision",
		}).AddRow(
			job.JobID, job.DocumentID, job.EmbeddingKind, job.EmbeddingModel,
			job.ContentSHA256, job.Priority, job.LeaseToken, job.LeaseFence, "legacy_unknown",
		))
	mock.ExpectQuery("SELECT document_id, normalized_text, status, normalized_sha256, input_revision, source_kind FROM atheros_search\\.search_documents").
		WithArgs(job.DocumentID).
		WillReturnRows(sqlmock.NewRows([]string{"document_id", "normalized_text", "status", "normalized_sha256", "input_revision", "source_kind"}).AddRow(job.DocumentID, "normalized wireless event", "active", testJob().ContentSHA256, "legacy_unknown", "event"))
	mock.ExpectCommit()
	mock.ExpectPing()
	mock.ExpectBegin()
	expectCompletionGuard(mock, job)
	mock.ExpectExec("INSERT INTO atheros_search\\.embeddings").
		WithArgs(job.DocumentID, job.EmbeddingKind, job.EmbeddingModel, job.ContentSHA256, testVectorJSON(), "legacy_unknown").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO atheros_search\\.search_vectors_event").
		WithArgs(job.DocumentID, job.EmbeddingModel, job.ContentSHA256, testVectorJSON(), "legacy_unknown").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("UPDATE atheros_search\\.embedding_jobs").
		WithArgs(job.JobID, job.LeaseToken, job.LeaseFence).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	pool := NewPool(db, checkingEmbedder{
		t:       t,
		dbPing:  db.PingContext,
		vectors: [][]float32{testVector()},
	}, PoolConfig{WorkerCount: 1, LeaseSeconds: 60, BatchSize: 1}, zerolog.Nop())
	pool.processBatch(context.Background(), "worker-1", zerolog.Nop())

	require.NoError(t, mock.ExpectationsWereMet())
}

type oversizedEmbedder struct {
	calls int
}

func (e *oversizedEmbedder) Embed(_ context.Context, texts []string, _ string) ([][]float32, error) {
	e.calls++
	if e.calls == 1 {
		return nil, &embed.OversizedInputError{Index: 0, Cause: errors.New("source tokenizes to 900 chunks, budget is 128")}
	}
	vectors := make([][]float32, len(texts))
	for i := range texts {
		vectors[i] = testVector()
	}
	return vectors, nil
}

func TestStoreCompletionsWritesGroupInOneTransaction(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	first := testJob()
	second := testJob()
	second.JobID = "job-2"
	second.DocumentID = "document-2"

	mock.ExpectBegin()
	expectCompletionGuard(mock, first)
	mock.ExpectExec("INSERT INTO atheros_search\\.embeddings").
		WithArgs(first.DocumentID, first.EmbeddingKind, first.EmbeddingModel, first.ContentSHA256, testVectorJSON(), "legacy_unknown").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO atheros_search\\.search_vectors_event").
		WithArgs(first.DocumentID, first.EmbeddingModel, first.ContentSHA256, testVectorJSON(), "legacy_unknown").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("UPDATE atheros_search\\.embedding_jobs").
		WithArgs(first.JobID, first.LeaseToken, first.LeaseFence).
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectCompletionGuard(mock, second)
	mock.ExpectExec("INSERT INTO atheros_search\\.embeddings").
		WithArgs(second.DocumentID, second.EmbeddingKind, second.EmbeddingModel, second.ContentSHA256, testVectorJSON(), "legacy_unknown").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO atheros_search\\.search_vectors_event").
		WithArgs(second.DocumentID, second.EmbeddingModel, second.ContentSHA256, testVectorJSON(), "legacy_unknown").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("UPDATE atheros_search\\.embedding_jobs").
		WithArgs(second.JobID, second.LeaseToken, second.LeaseFence).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	pool := NewPool(db, checkingEmbedder{}, PoolConfig{}, zerolog.Nop())
	require.NoError(t, pool.storeCompletions(
		context.Background(),
		[]Job{first, second},
		[][]float32{testVector(), testVector()},
	))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestProcessBatchFailsOversizedJobAndCompletesTheRest(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	first := testJob()
	second := testJob()
	second.JobID = "job-2"
	second.DocumentID = "document-2"

	mock.ExpectBegin()
	mock.ExpectQuery("UPDATE atheros_search\\.embedding_jobs").
		WithArgs("worker-1", sqlmock.AnyArg(), 2, "null", "", "legacy_unknown").
		WillReturnRows(sqlmock.NewRows([]string{
			"job_id", "document_id", "embedding_kind", "embedding_model",
			"content_sha256", "priority", "lease_token", "lease_fence", "input_revision",
		}).
			AddRow(first.JobID, first.DocumentID, first.EmbeddingKind, first.EmbeddingModel,
				first.ContentSHA256, first.Priority, first.LeaseToken, first.LeaseFence, "legacy_unknown").
			AddRow(second.JobID, second.DocumentID, second.EmbeddingKind, second.EmbeddingModel,
				second.ContentSHA256, second.Priority, second.LeaseToken, second.LeaseFence, "legacy_unknown"))
	mock.ExpectQuery("SELECT document_id, normalized_text, status, normalized_sha256, input_revision, source_kind FROM atheros_search\\.search_documents").
		WithArgs(first.DocumentID, second.DocumentID).
		WillReturnRows(sqlmock.NewRows([]string{"document_id", "normalized_text", "status", "normalized_sha256", "input_revision", "source_kind"}).
			AddRow(first.DocumentID, "normalized wireless event", "active", testJob().ContentSHA256, "legacy_unknown", "event").
			AddRow(second.DocumentID, "normalized wireless event", "active", testJob().ContentSHA256, "legacy_unknown", "event"))
	mock.ExpectCommit()

	mock.ExpectBegin()
	mock.ExpectExec("UPDATE atheros_search\\.embedding_jobs").
		WithArgs(sqlmock.AnyArg(), first.JobID, first.LeaseToken, first.LeaseFence).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	mock.ExpectBegin()
	expectCompletionGuard(mock, second)
	mock.ExpectExec("INSERT INTO atheros_search\\.embeddings").
		WithArgs(second.DocumentID, second.EmbeddingKind, second.EmbeddingModel, second.ContentSHA256, testVectorJSON(), "legacy_unknown").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO atheros_search\\.search_vectors_event").
		WithArgs(second.DocumentID, second.EmbeddingModel, second.ContentSHA256, testVectorJSON(), "legacy_unknown").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("UPDATE atheros_search\\.embedding_jobs").
		WithArgs(second.JobID, second.LeaseToken, second.LeaseFence).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	pool := NewPool(db, &oversizedEmbedder{}, PoolConfig{WorkerCount: 1, LeaseSeconds: 60, BatchSize: 2}, zerolog.Nop())
	pool.processBatch(context.Background(), "worker-1", zerolog.Nop())

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestProcessBatchCancelsMissingDocumentAndCompletesTheRest(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	missing := testJob()
	missing.JobID = "job-missing"
	missing.DocumentID = "document-missing"
	good := testJob()
	good.JobID = "job-good"
	good.DocumentID = "document-good"

	mock.ExpectBegin()
	mock.ExpectQuery("UPDATE atheros_search\\.embedding_jobs").
		WithArgs("worker-1", sqlmock.AnyArg(), 2, "null", "", "legacy_unknown").
		WillReturnRows(sqlmock.NewRows([]string{
			"job_id", "document_id", "embedding_kind", "embedding_model",
			"content_sha256", "priority", "lease_token", "lease_fence", "input_revision",
		}).
			AddRow(missing.JobID, missing.DocumentID, missing.EmbeddingKind, missing.EmbeddingModel,
				missing.ContentSHA256, missing.Priority, missing.LeaseToken, missing.LeaseFence, "legacy_unknown").
			AddRow(good.JobID, good.DocumentID, good.EmbeddingKind, good.EmbeddingModel,
				good.ContentSHA256, good.Priority, good.LeaseToken, good.LeaseFence, "legacy_unknown"))
	mock.ExpectQuery("SELECT document_id, normalized_text, status, normalized_sha256, input_revision, source_kind FROM atheros_search\\.search_documents").
		WithArgs(missing.DocumentID, good.DocumentID).
		WillReturnRows(sqlmock.NewRows([]string{"document_id", "normalized_text", "status", "normalized_sha256", "input_revision", "source_kind"}).
			AddRow(good.DocumentID, "normalized wireless event", "active", testJob().ContentSHA256, "legacy_unknown", "event"))
	mock.ExpectExec("UPDATE atheros_search\\.embedding_jobs").
		WithArgs("document missing; embedding job cancelled", missing.JobID, missing.LeaseToken, missing.LeaseFence).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	mock.ExpectPing()
	mock.ExpectBegin()
	expectCompletionGuard(mock, good)
	mock.ExpectExec("INSERT INTO atheros_search\\.embeddings").
		WithArgs(good.DocumentID, good.EmbeddingKind, good.EmbeddingModel, good.ContentSHA256, testVectorJSON(), "legacy_unknown").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO atheros_search\\.search_vectors_event").
		WithArgs(good.DocumentID, good.EmbeddingModel, good.ContentSHA256, testVectorJSON(), "legacy_unknown").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("UPDATE atheros_search\\.embedding_jobs").
		WithArgs(good.JobID, good.LeaseToken, good.LeaseFence).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	pool := NewPool(db, checkingEmbedder{
		t:       t,
		dbPing:  db.PingContext,
		vectors: [][]float32{testVector()},
	}, PoolConfig{WorkerCount: 1, LeaseSeconds: 60, BatchSize: 2}, zerolog.Nop())
	pool.processBatch(context.Background(), "worker-1", zerolog.Nop())

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestProcessBatchCancelsNonActiveDocumentWithoutEmbedding(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	job := testJob()
	mock.ExpectBegin()
	mock.ExpectQuery("UPDATE atheros_search\\.embedding_jobs").
		WithArgs("worker-1", sqlmock.AnyArg(), 1, "null", "", "legacy_unknown").
		WillReturnRows(sqlmock.NewRows([]string{
			"job_id", "document_id", "embedding_kind", "embedding_model",
			"content_sha256", "priority", "lease_token", "lease_fence", "input_revision",
		}).AddRow(
			job.JobID, job.DocumentID, job.EmbeddingKind, job.EmbeddingModel,
			job.ContentSHA256, job.Priority, job.LeaseToken, job.LeaseFence, "legacy_unknown"))
	mock.ExpectQuery("SELECT document_id, normalized_text, status, normalized_sha256, input_revision, source_kind FROM atheros_search\\.search_documents").
		WithArgs(job.DocumentID).
		WillReturnRows(sqlmock.NewRows([]string{"document_id", "normalized_text", "status", "normalized_sha256", "input_revision", "source_kind"}).
			AddRow(job.DocumentID, "stale text", "superseded", testJob().ContentSHA256, "legacy_unknown", "event"))
	mock.ExpectExec("UPDATE atheros_search\\.embedding_jobs").
		WithArgs("document status superseded; embedding job cancelled", job.JobID, job.LeaseToken, job.LeaseFence).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	pool := NewPool(db, checkingEmbedder{t: t}, PoolConfig{WorkerCount: 1, LeaseSeconds: 60, BatchSize: 1}, zerolog.Nop())
	pool.processBatch(context.Background(), "worker-1", zerolog.Nop())

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestProcessBatchCommitsWhenAllClaimedJobsAreDead(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	first := testJob()
	second := testJob()
	second.JobID = "job-2"
	second.DocumentID = "document-2"

	mock.ExpectBegin()
	mock.ExpectQuery("UPDATE atheros_search\\.embedding_jobs").
		WithArgs("worker-1", sqlmock.AnyArg(), 2, "null", "", "legacy_unknown").
		WillReturnRows(sqlmock.NewRows([]string{
			"job_id", "document_id", "embedding_kind", "embedding_model",
			"content_sha256", "priority", "lease_token", "lease_fence", "input_revision",
		}).
			AddRow(first.JobID, first.DocumentID, first.EmbeddingKind, first.EmbeddingModel,
				first.ContentSHA256, first.Priority, first.LeaseToken, first.LeaseFence, "legacy_unknown").
			AddRow(second.JobID, second.DocumentID, second.EmbeddingKind, second.EmbeddingModel,
				second.ContentSHA256, second.Priority, second.LeaseToken, second.LeaseFence, "legacy_unknown"))
	mock.ExpectQuery("SELECT document_id, normalized_text, status, normalized_sha256, input_revision, source_kind FROM atheros_search\\.search_documents").
		WithArgs(first.DocumentID, second.DocumentID).
		WillReturnRows(sqlmock.NewRows([]string{"document_id", "normalized_text", "status", "normalized_sha256", "input_revision", "source_kind"}))
	mock.ExpectExec("UPDATE atheros_search\\.embedding_jobs").
		WithArgs("document missing; embedding job cancelled", first.JobID, first.LeaseToken, first.LeaseFence).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE atheros_search\\.embedding_jobs").
		WithArgs("document missing; embedding job cancelled", second.JobID, second.LeaseToken, second.LeaseFence).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	pool := NewPool(db, checkingEmbedder{t: t}, PoolConfig{WorkerCount: 1, LeaseSeconds: 60, BatchSize: 2}, zerolog.Nop())
	pool.processBatch(context.Background(), "worker-1", zerolog.Nop())

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestStoreCompletionRollsBackVectorWhenLeaseIsLost(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	job := testJob()
	mock.ExpectBegin()
	expectCompletionGuard(mock, job)
	mock.ExpectExec("INSERT INTO atheros_search\\.embeddings").
		WithArgs(job.DocumentID, job.EmbeddingKind, job.EmbeddingModel, job.ContentSHA256, testVectorJSON(), "legacy_unknown").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO atheros_search\\.search_vectors_event").
		WithArgs(job.DocumentID, job.EmbeddingModel, job.ContentSHA256, testVectorJSON(), "legacy_unknown").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("UPDATE atheros_search\\.embedding_jobs").
		WithArgs(job.JobID, job.LeaseToken, job.LeaseFence).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()

	pool := NewPool(db, checkingEmbedder{}, PoolConfig{}, zerolog.Nop())
	err = pool.storeCompletion(context.Background(), job, testVector())
	require.ErrorContains(t, err, "lease lost")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestStoreCompletionRollsBackWhenVectorWriteFails(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	job := testJob()
	mock.ExpectBegin()
	expectCompletionGuard(mock, job)
	mock.ExpectExec("INSERT INTO atheros_search\\.embeddings").
		WithArgs(job.DocumentID, job.EmbeddingKind, job.EmbeddingModel, job.ContentSHA256, testVectorJSON(), "legacy_unknown").
		WillReturnError(errors.New("vector write failed"))
	mock.ExpectRollback()

	pool := NewPool(db, checkingEmbedder{}, PoolConfig{}, zerolog.Nop())
	err = pool.storeCompletion(context.Background(), job, testVector())
	require.ErrorContains(t, err, "vector write failed")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestStoreCompletionHonorsCancellationBeforeTransaction(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	pool := NewPool(db, checkingEmbedder{}, PoolConfig{}, zerolog.Nop())
	err = pool.storeCompletion(ctx, testJob(), testVector())
	require.ErrorIs(t, err, context.Canceled)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRenewJobLeaseUsesTokenFenceAndReportsLeaseLoss(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	job := testJob()
	expiresAt := time.Now().Add(time.Minute)
	mock.ExpectExec("UPDATE atheros_search\\.embedding_jobs").
		WithArgs(expiresAt, job.JobID, job.LeaseToken, job.LeaseFence).
		WillReturnResult(sqlmock.NewResult(0, 0))

	renewed, err := renewJobLease(context.Background(), db, job, expiresAt)
	require.NoError(t, err)
	require.False(t, renewed)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRecoverExpiredLeasesIsBounded(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	mock.ExpectExec("UPDATE atheros_search\\.embedding_jobs").
		WithArgs(25, "null", "", "legacy_unknown").
		WillReturnResult(sqlmock.NewResult(0, 3))

	recovered, err := recoverExpiredLeases(context.Background(), db, 25)
	require.NoError(t, err)
	require.Equal(t, int64(3), recovered)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestUpsertHeartbeatDefaultsMissingMetadataToObject(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	mock.ExpectExec("INSERT INTO atheros_search\\.worker_heartbeat").
		WithArgs("worker-1", "pool", json.RawMessage(`{}`)).
		WillReturnResult(sqlmock.NewResult(1, 1))

	require.NoError(t, upsertHeartbeat(context.Background(), db, "worker-1", "pool", nil))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestDeferJobPreservesAttemptForCircuitRetry(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	job := testJob()
	retryAt := time.Now().Add(time.Minute)
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE atheros_search\\.embedding_jobs").
		WithArgs(retryAt, job.JobID, job.LeaseToken, job.LeaseFence).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	tx, err := db.BeginTx(context.Background(), nil)
	require.NoError(t, err)
	require.NoError(t, deferJob(context.Background(), tx, job.JobID, job.LeaseToken, job.LeaseFence, retryAt))
	require.NoError(t, tx.Commit())
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestPoolStopCancelsWorkersAndRecovery(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	pool := NewPool(db, checkingEmbedder{}, PoolConfig{
		WorkerCount:  2,
		LeaseSeconds: 60,
		PollInterval: time.Hour,
		BatchSize:    1,
	}, zerolog.Nop())
	pool.Start(context.Background())

	stopped := make(chan struct{})
	go func() {
		pool.Stop()
		close(stopped)
	}()

	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("worker pool did not stop after cancellation")
	}
	require.NoError(t, mock.ExpectationsWereMet())
}

func testJob() Job {
	return Job{
		JobID:          "job-1",
		DocumentID:     "document-1",
		EmbeddingKind:  "event",
		EmbeddingModel: "model-1",
		ContentSHA256:  textChecksum("normalized wireless event"),
		InputRevision:  "legacy_unknown",
		Priority:       10,
		LeaseToken:     "token-1",
		LeaseFence:     7,
	}
}

func testVector() []float32  { v := make([]float32, 768); v[0] = 1; return v }
func testVectorJSON() string { b, _ := json.Marshal(testVector()); return string(b) }
func expectCompletionGuard(mock sqlmock.Sqlmock, job Job) {
	mock.ExpectExec("SELECT pg_advisory_xact_lock").WithArgs(job.DocumentID).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT normalized_text, normalized_sha256, input_revision").WithArgs(job.DocumentID).
		WillReturnRows(sqlmock.NewRows([]string{"normalized_text", "normalized_sha256", "input_revision", "source_kind"}).AddRow("normalized wireless event", job.ContentSHA256, "legacy_unknown", "event"))
	mock.ExpectQuery("SELECT 1 FROM atheros_search\\.embedding_jobs").
		WithArgs(job.JobID, job.DocumentID, job.ContentSHA256, job.EmbeddingModel, "legacy_unknown", job.LeaseToken, job.LeaseFence, job.EmbeddingKind).
		WillReturnRows(sqlmock.NewRows([]string{"present"}).AddRow(1))
}
