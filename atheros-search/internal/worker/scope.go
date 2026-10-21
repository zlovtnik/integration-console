package worker

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

type JobScope struct {
	SourceKinds   []string
	Model         string
	InputRevision string
}

func scopeArgs(scopes []JobScope) (string, string, string) {
	scope := JobScope{InputRevision: "legacy_unknown"}
	if len(scopes) > 0 {
		scope = scopes[0]
	}
	if scope.InputRevision == "" {
		scope.InputRevision = "legacy_unknown"
	}
	encoded, _ := json.Marshal(scope.SourceKinds)
	return string(encoded), scope.Model, scope.InputRevision
}

func textChecksum(text string) string {
	digest := sha256.Sum256([]byte(text))
	return hex.EncodeToString(digest[:])
}

func embeddingKindForSource(kind string) string {
	switch kind {
	case "event", "proxy_event", "proxy_blocked_host_window":
		return "event"
	case "device", "device_profile", "ap_profile", "identity_summary":
		return "device"
	case "behaviour_window", "observation_window":
		return "behaviour"
	case "frame_sequence":
		return "sequence"
	default:
		return "invalid"
	}
}

func guardCompletion(ctx context.Context, tx *sql.Tx, job Job) error {
	revision := job.InputRevision
	if revision == "" {
		revision = "legacy_unknown"
	}
	// The reader role cannot take a row lock on search_documents (PostgreSQL
	// requires UPDATE privilege). Both owners serialize on the same source
	// advisory lock, then check current content before locking the job.
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended(jsonb_build_array(source_table,source_key)::text,0))
      FROM atheros_search.search_documents WHERE document_id=$1`, job.DocumentID); err != nil {
		return err
	}
	var text, checksum, currentRevision, sourceKind string
	err := tx.QueryRowContext(ctx, `SELECT normalized_text, normalized_sha256, input_revision, source_kind
      FROM atheros_search.search_documents WHERE document_id = $1 AND status = 'active'`, job.DocumentID).Scan(&text, &checksum, &currentRevision, &sourceKind)
	if err != nil {
		return fmt.Errorf("current embedding document unavailable: %w", err)
	}
	if checksum != job.ContentSHA256 || textChecksum(text) != checksum || revision != currentRevision || embeddingKindForSource(sourceKind) != job.EmbeddingKind {
		return fmt.Errorf("embedding document input changed")
	}
	var present int
	err = tx.QueryRowContext(ctx, `SELECT 1 FROM atheros_search.embedding_jobs WHERE job_id=$1
      AND document_id=$2 AND content_sha256=$3 AND embedding_model=$4 AND input_revision=$5
      AND status='leased' AND lease_token=$6 AND lease_fence=$7 AND embedding_kind=$8 AND lease_expires_at > clock_timestamp()
      FOR UPDATE`, job.JobID, job.DocumentID, job.ContentSHA256, job.EmbeddingModel, revision, job.LeaseToken, job.LeaseFence, job.EmbeddingKind).Scan(&present)
	if err != nil {
		return fmt.Errorf("lease lost or embedding input changed: %w", err)
	}
	return nil
}
