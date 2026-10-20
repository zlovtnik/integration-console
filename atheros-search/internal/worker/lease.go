package worker

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/embed"
)

// claimJobs leases pending jobs and attaches active document text. Jobs whose
// document is missing or no longer active are cancelled in the same
// transaction so one orphan cannot poison the batch or loop forever.
func claimJobs(ctx context.Context, tx *sql.Tx, ownerID string, limit int, leaseExpiresAt time.Time, scopes ...JobScope) ([]Job, int, error) {
	kinds, model, revision := scopeArgs(scopes)
	rows, err := tx.QueryContext(ctx, `
WITH candidates AS (
  SELECT job_id
  FROM atheros_search.embedding_jobs
  WHERE status = 'pending'
    AND next_attempt_at <= CURRENT_TIMESTAMP
    AND attempt_count < max_attempts
    AND ($5 = '' OR embedding_model = $5) AND input_revision = $6
    AND ($4::jsonb = 'null'::jsonb OR $4::jsonb = '[]'::jsonb OR EXISTS (
      SELECT 1 FROM atheros_search.search_documents scoped WHERE scoped.document_id = embedding_jobs.document_id
        AND scoped.source_kind IN (SELECT jsonb_array_elements_text($4::jsonb))))
  ORDER BY priority ASC, next_attempt_at ASC, job_id ASC
  FOR UPDATE SKIP LOCKED
  LIMIT $3
)
UPDATE atheros_search.embedding_jobs AS jobs
SET status = 'leased',
    owner_id = $1,
    lease_token = gen_random_uuid(),
    lease_fence = lease_fence + 1,
    lease_expires_at = $2,
    attempt_count = attempt_count + 1,
    updated_at = CURRENT_TIMESTAMP
FROM candidates
WHERE jobs.job_id = candidates.job_id
RETURNING jobs.job_id, jobs.document_id, jobs.embedding_kind, jobs.embedding_model,
          jobs.content_sha256, jobs.priority, jobs.lease_token, jobs.lease_fence, jobs.input_revision
`, ownerID, leaseExpiresAt, limit, kinds, model, revision)
	if err != nil {
		return nil, 0, fmt.Errorf("claim embedding jobs: %w", err)
	}
	defer func() { _ = rows.Close() }() // Release resources on early return; query, scan, and iteration errors are checked separately.

	var jobs []Job
	for rows.Next() {
		var j Job
		if err := rows.Scan(&j.JobID, &j.DocumentID, &j.EmbeddingKind, &j.EmbeddingModel, &j.ContentSHA256, &j.Priority, &j.LeaseToken, &j.LeaseFence, &j.InputRevision); err != nil {
			return nil, 0, fmt.Errorf("scan claimed job: %w", err)
		}
		jobs = append(jobs, j)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate claimed jobs: %w", err)
	}
	if len(jobs) == 0 {
		return jobs, 0, nil
	}

	placeholders := make([]string, 0, len(jobs))
	seen := make(map[string]struct{}, len(jobs))
	args := make([]any, 0, len(jobs))
	for _, job := range jobs {
		if _, duplicate := seen[job.DocumentID]; duplicate {
			continue
		}
		seen[job.DocumentID] = struct{}{}
		placeholders = append(placeholders, fmt.Sprintf("$%d", len(args)+1))
		args = append(args, job.DocumentID)
	}
	textRows, err := tx.QueryContext(ctx, fmt.Sprintf(`
SELECT document_id, normalized_text, status, normalized_sha256, input_revision, source_kind FROM atheros_search.search_documents
WHERE document_id IN (%s)
`, strings.Join(placeholders, ", ")), args...)
	if err != nil {
		return nil, 0, fmt.Errorf("fetch document text: %w", err)
	}
	defer func() { _ = textRows.Close() }() // Release resources on early return; query, scan, and iteration errors are checked separately.
	type documentText struct {
		text     string
		status   string
		checksum string
		revision string
		kind     string
	}
	docByDocument := make(map[string]documentText, len(seen))
	for textRows.Next() {
		var documentID, normalizedText, status, checksum, inputRevision, sourceKind string
		if err := textRows.Scan(&documentID, &normalizedText, &status, &checksum, &inputRevision, &sourceKind); err != nil {
			return nil, 0, fmt.Errorf("scan document text: %w", err)
		}
		docByDocument[documentID] = documentText{text: normalizedText, status: status, checksum: checksum, revision: inputRevision, kind: sourceKind}
	}
	if err := textRows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate document text: %w", err)
	}

	cancelled := 0
	ready := make([]Job, 0, len(jobs))
	for _, job := range jobs {
		doc, ok := docByDocument[job.DocumentID]
		if !ok {
			if err := cancelJob(ctx, tx, job.JobID, job.LeaseToken, job.LeaseFence, "document missing; embedding job cancelled"); err != nil {
				return nil, 0, err
			}
			cancelled++
			continue
		}
		if doc.status != "active" {
			if err := cancelJob(ctx, tx, job.JobID, job.LeaseToken, job.LeaseFence, fmt.Sprintf("document status %s; embedding job cancelled", doc.status)); err != nil {
				return nil, 0, err
			}
			cancelled++
			continue
		}
		if doc.checksum != job.ContentSHA256 || textChecksum(doc.text) != doc.checksum || doc.revision != job.InputRevision || embeddingKindForSource(doc.kind) != job.EmbeddingKind {
			if err := cancelJob(ctx, tx, job.JobID, job.LeaseToken, job.LeaseFence, "document input checksum or revision changed"); err != nil {
				return nil, 0, err
			}
			cancelled++
			continue
		}
		job.NormalizedText = doc.text
		ready = append(ready, job)
	}

	return ready, cancelled, nil
}

// cancelJob parks a claimed job as durable dead work. Missing and non-active
// documents will not become embeddable without a new job, so this is terminal
// and must not use failJob (retry-failed would resurrect cancelled rows).
func cancelJob(ctx context.Context, tx *sql.Tx, jobID, leaseToken string, leaseFence int64, errMsg string) error {
	result, err := tx.ExecContext(ctx, `
UPDATE atheros_search.embedding_jobs
SET status = 'cancelled',
    last_error = $1,
    owner_id = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    next_attempt_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE job_id = $2
  AND status = 'leased'
  AND lease_token = $3
  AND lease_fence = $4
  AND lease_expires_at > clock_timestamp()
`, errMsg, jobID, leaseToken, leaseFence)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return fmt.Errorf("lease lost for job %s: no matching lease token or lease expired", jobID)
	}
	return nil
}

func completeJob(ctx context.Context, tx *sql.Tx, jobID, leaseToken string, leaseFence int64) error {
	result, err := tx.ExecContext(ctx, `
UPDATE atheros_search.embedding_jobs
SET status = 'completed',
    owner_id = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    completed_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE job_id = $1
  AND status = 'leased'
  AND lease_token = $2
  AND lease_fence = $3
  AND lease_expires_at > clock_timestamp()
`, jobID, leaseToken, leaseFence)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return fmt.Errorf("lease lost for job %s: no matching lease token or lease expired", jobID)
	}
	return nil
}

func failJob(ctx context.Context, tx *sql.Tx, jobID, leaseToken string, leaseFence int64, errMsg string) error {
	maxBackoff := 300 * time.Second
	result, err := tx.ExecContext(ctx, `
UPDATE atheros_search.embedding_jobs
SET status = CASE
        WHEN attempt_count >= max_attempts THEN 'failed'
        ELSE 'pending'
    END,
    last_error = $1,
    owner_id = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    next_attempt_at = CURRENT_TIMESTAMP + LEAST(POWER(2, attempt_count), $2) * INTERVAL '1 second',
    updated_at = CURRENT_TIMESTAMP
WHERE job_id = $3
  AND status = 'leased'
  AND lease_token = $4
  AND lease_fence = $5
  AND lease_expires_at > clock_timestamp()
`, errMsg, int(maxBackoff.Seconds()), jobID, leaseToken, leaseFence)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return fmt.Errorf("lease lost for job %s: no matching lease token or lease expired", jobID)
	}
	return nil
}

// failJobPermanently ends a job regardless of remaining attempts. It is for
// durable outcomes the backend will never succeed on, such as a source above
// the chunk budget: retrying would only burn attempts on an input that cannot
// change until an operator raises the budget and runs the repair tool.
func failJobPermanently(ctx context.Context, tx *sql.Tx, jobID, leaseToken string, leaseFence int64, errMsg string) error {
	result, err := tx.ExecContext(ctx, `
UPDATE atheros_search.embedding_jobs
SET status = 'failed',
    last_error = $1,
    owner_id = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    next_attempt_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE job_id = $2
  AND status = 'leased'
  AND lease_token = $3
  AND lease_fence = $4
  AND lease_expires_at > clock_timestamp()
`, errMsg, jobID, leaseToken, leaseFence)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return fmt.Errorf("lease lost for job %s: no matching lease token or lease expired", jobID)
	}
	return nil
}

// deferJob returns a lease to pending at the circuit retry time. Claiming is
// bookkeeping, not a backend attempt, so this reverses its single increment.
func deferJob(ctx context.Context, tx *sql.Tx, jobID, leaseToken string, leaseFence int64, retryAt time.Time) error {
	result, err := tx.ExecContext(ctx, `
UPDATE atheros_search.embedding_jobs
SET status = 'pending',
    owner_id = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    attempt_count = GREATEST(attempt_count - 1, 0),
    next_attempt_at = $1,
    updated_at = CURRENT_TIMESTAMP
WHERE job_id = $2
  AND status = 'leased'
  AND lease_token = $3
  AND lease_fence = $4
  AND lease_expires_at > clock_timestamp()
`, retryAt, jobID, leaseToken, leaseFence)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return fmt.Errorf("lease lost for job %s: no matching lease token or lease expired", jobID)
	}
	return nil
}

func renewJobLease(ctx context.Context, db *sql.DB, job Job, leaseExpiresAt time.Time) (bool, error) {
	result, err := db.ExecContext(ctx, `
UPDATE atheros_search.embedding_jobs
SET lease_expires_at = $1, updated_at = CURRENT_TIMESTAMP
WHERE job_id = $2
  AND status = 'leased'
  AND lease_token = $3
  AND lease_fence = $4
  AND lease_expires_at > clock_timestamp()
`, leaseExpiresAt, job.JobID, job.LeaseToken, job.LeaseFence)
	if err != nil {
		return false, fmt.Errorf("renew embedding lease: %w", err)
	}
	affected, err := result.RowsAffected()
	return affected == 1, err
}

func recoverExpiredLeases(ctx context.Context, db *sql.DB, limit int, scopes ...JobScope) (int64, error) {
	kinds, model, revision := scopeArgs(scopes)
	result, err := db.ExecContext(ctx, `
WITH expired AS (
  SELECT job_id
  FROM atheros_search.embedding_jobs
  WHERE status = 'leased' AND lease_expires_at <= CURRENT_TIMESTAMP
    AND ($3 = '' OR embedding_model = $3) AND input_revision = $4
    AND ($2::jsonb = 'null'::jsonb OR $2::jsonb = '[]'::jsonb OR EXISTS (
      SELECT 1 FROM atheros_search.search_documents scoped WHERE scoped.document_id = embedding_jobs.document_id
        AND scoped.source_kind IN (SELECT jsonb_array_elements_text($2::jsonb))))
  ORDER BY lease_expires_at, job_id
  FOR UPDATE SKIP LOCKED
  LIMIT $1
)
UPDATE atheros_search.embedding_jobs AS jobs
SET status = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'pending' END,
    owner_id = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    last_error = CASE
      WHEN attempt_count >= max_attempts THEN 'embedding lease expired; retries exhausted'
      ELSE 'embedding lease expired; returned to pending'
    END,
    next_attempt_at = CURRENT_TIMESTAMP + LEAST(POWER(2, jobs.attempt_count), 300) * INTERVAL '1 second',
    updated_at = CURRENT_TIMESTAMP
FROM expired
WHERE jobs.job_id = expired.job_id
`, limit, kinds, model, revision)
	if err != nil {
		return 0, fmt.Errorf("recover expired embedding leases: %w", err)
	}
	return result.RowsAffected()
}

func normalizeEmbeddingKind(kind string) (string, error) {
	switch kind {
	case "event":
		return "event", nil
	case "device":
		return "device", nil
	case "behaviour", "behavior", "behaviour_window", "behavior_window":
		return "behaviour", nil
	case "sequence", "frame_sequence":
		return "sequence", nil
	default:
		return "", fmt.Errorf("unknown embedding kind: %s", kind)
	}
}

func insertVector(ctx context.Context, tx *sql.Tx, documentID, embeddingKind, embeddingModel, contentSHA256 string, embedding []float32, inputRevisions ...string) error {
	if err := embed.ValidateVector(embedding, 768); err != nil {
		return err
	}
	revision := "legacy_unknown"
	if len(inputRevisions) > 0 && inputRevisions[0] != "" {
		revision = inputRevisions[0]
	}
	vectorTable, err := vectorTableForKind(embeddingKind)
	if err != nil {
		return err
	}
	encoded, err := json.Marshal(embedding)
	if err != nil {
		return fmt.Errorf("encode embedding vector: %w", err)
	}
	vecStr := string(encoded)
	_, err = tx.ExecContext(ctx, `
INSERT INTO atheros_search.embeddings (
  document_id, embedding_kind, embedding_model, content_sha256, embedding, embedded_at, input_revision
)
VALUES ($1, $2, $3, $4, $5::public.vector, CURRENT_TIMESTAMP, $6)
ON CONFLICT (document_id, embedding_kind, embedding_model, input_revision) DO UPDATE SET
  embedding = EXCLUDED.embedding,
  content_sha256 = EXCLUDED.content_sha256,
  embedded_at = CURRENT_TIMESTAMP
`, documentID, embeddingKind, embeddingModel, contentSHA256, vecStr, revision)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, fmt.Sprintf(`
INSERT INTO atheros_search.%s (
  document_id, embedding_model, content_sha256, embedding, embedded_at, input_revision
) VALUES ($1, $2, $3, $4::public.vector, CURRENT_TIMESTAMP, $5)
ON CONFLICT (document_id, embedding_model, input_revision) DO UPDATE SET
  content_sha256 = EXCLUDED.content_sha256,
  embedding = EXCLUDED.embedding,
  embedded_at = CURRENT_TIMESTAMP
`, vectorTable), documentID, embeddingModel, contentSHA256, vecStr, revision)
	return err
}

func vectorTableForKind(kind string) (string, error) {
	switch kind {
	case "event":
		return "search_vectors_event", nil
	case "device":
		return "search_vectors_device", nil
	case "behaviour":
		return "search_vectors_behaviour", nil
	case "sequence":
		return "search_vectors_sequence", nil
	default:
		return "", fmt.Errorf("unknown embedding kind: %s", kind)
	}
}

func upsertHeartbeat(ctx context.Context, db *sql.DB, workerID, workerType string, metadata json.RawMessage) error {
	if len(metadata) == 0 {
		metadata = json.RawMessage(`{}`)
	}
	_, err := db.ExecContext(ctx, `
INSERT INTO atheros_search.worker_heartbeat (worker_id, worker_type, last_seen_at, metadata)
VALUES ($1, $2, CURRENT_TIMESTAMP, $3)
ON CONFLICT (worker_id) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP, metadata = EXCLUDED.metadata
`, workerID, workerType, metadata)
	return err
}
