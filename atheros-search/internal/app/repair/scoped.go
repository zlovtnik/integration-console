package repair

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Scoped repairs are keyset pages. A returned job ID is an opaque resumable
// cursor, never source text or a device identity. Failed/cancelled/exhausted
// work is not revived by a missing-vector repair.
type Scope struct {
	CampaignID    string
	CreatedBefore time.Time
	Kinds         []string
	Model         string
	InputRevision string
	AfterJobID    string
	Limit         int
}

func (s Scope) validate() error {
	if s.Limit < 1 || s.Limit > 1000 || s.Model == "" || s.InputRevision == "" || len(s.Kinds) == 0 {
		return fmt.Errorf("scoped repair requires kinds, model, input revision and limit 1..1000")
	}
	for _, kind := range s.Kinds {
		if kind != "proxy_event" && kind != "proxy_blocked_host_window" {
			return fmt.Errorf("scoped proxy repair has an unsupported kind")
		}
	}
	if strings.TrimSpace(s.AfterJobID) != s.AfterJobID {
		return fmt.Errorf("invalid repair cursor")
	}
	if s.CreatedBefore.IsZero() {
		return fmt.Errorf("scoped repair requires a frozen created-before cutoff")
	}
	return nil
}

type Page struct {
	Scanned                int
	CompletedMissingVector int
	Retried                int64
	AfterJobID             string
}

func repairProxyPage(ctx context.Context, db *sql.DB, scope Scope, apply bool) (Page, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var page Page
	if err := scope.validate(); err != nil {
		return page, err
	}
	if apply && (strings.TrimSpace(scope.CampaignID) == "" || len(scope.CampaignID) > 128) {
		return page, fmt.Errorf("applied proxy repair requires a campaign-id of at most 128 characters")
	}
	scope.Kinds = append([]string(nil), scope.Kinds...)
	sort.Strings(scope.Kinds)
	encoded, err := json.Marshal(scope.Kinds)
	if err != nil {
		return page, err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted, ReadOnly: !apply})
	if err != nil {
		return page, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `SELECT set_config('statement_timeout','5000',true),set_config('lock_timeout','1000',true)`); err != nil {
		return page, err
	}
	scopeJSON, _ := json.Marshal([]any{scope.Kinds, scope.Model, scope.InputRevision, scope.CreatedBefore.UTC().Format(time.RFC3339Nano)})
	scopeHash := fmt.Sprintf("%x", sha256.Sum256(scopeJSON))
	if apply {
		if _, err := tx.ExecContext(ctx, `INSERT INTO atheros_search.embedding_repair_progress(campaign_id,scope_sha256)
          VALUES($1,$2) ON CONFLICT DO NOTHING`, scope.CampaignID, scopeHash); err != nil {
			return page, err
		}
		var storedHash, after string
		if err := tx.QueryRowContext(ctx, `SELECT scope_sha256,COALESCE(after_job_id::text,'') FROM atheros_search.embedding_repair_progress WHERE campaign_id=$1 FOR UPDATE`, scope.CampaignID).Scan(&storedHash, &after); err != nil {
			return page, err
		}
		if storedHash != scopeHash || (scope.AfterJobID != "" && scope.AfterJobID != after) {
			return page, fmt.Errorf("repair campaign scope or cursor mismatch")
		}
		scope.AfterJobID = after
	}
	var after any
	if scope.AfterJobID != "" {
		after = scope.AfterJobID
	}
	// Bound inputs first, including healthy and terminal jobs. Durable receipts
	// retain diagnostics; retries do not reset attempt_count or max_attempts.
	rows, err := tx.QueryContext(ctx, `SELECT job.job_id::text,
      job.status = 'completed' AND job.attempt_count < job.max_attempts
      AND doc.status='active' AND doc.normalized_sha256=job.content_sha256 AND doc.input_revision=job.input_revision
      AND doc.normalized_sha256=encode(sha256(convert_to(doc.normalized_text,'UTF8')), 'hex')
      AND NOT EXISTS (SELECT 1 FROM atheros_search.embeddings unified
        JOIN atheros_search.search_vectors_event per_kind ON per_kind.document_id=unified.document_id
          AND per_kind.embedding_model=unified.embedding_model AND per_kind.input_revision=unified.input_revision
          AND per_kind.content_sha256=unified.content_sha256 AND per_kind.embedding::text=unified.embedding::text
        WHERE unified.document_id=job.document_id AND unified.embedding_model=job.embedding_model
          AND unified.input_revision=job.input_revision AND unified.embedding_kind='event' AND unified.content_sha256=job.content_sha256)
      FROM atheros_search.embedding_jobs job JOIN atheros_search.search_documents doc ON doc.document_id=job.document_id
      WHERE doc.source_kind IN (SELECT jsonb_array_elements_text($1::jsonb))
        AND job.embedding_model=$2 AND job.input_revision=$3 AND ($4::uuid IS NULL OR job.job_id > $4::uuid)
        AND job.created_at < $6
      ORDER BY job.job_id LIMIT $5`, string(encoded), scope.Model, scope.InputRevision, after, scope.Limit, scope.CreatedBefore)
	if err != nil {
		return page, err
	}
	var ids []string
	for rows.Next() {
		var id string
		var eligible bool
		if err := rows.Scan(&id, &eligible); err != nil {
			_ = rows.Close()
			return page, err
		}
		page.Scanned++
		page.AfterJobID = id
		if eligible {
			page.CompletedMissingVector++
			ids = append(ids, id)
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return page, err
	}
	if err := rows.Close(); err != nil {
		return page, err
	}
	if apply {
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('proxy-embedding-queue',0))`); err != nil {
			return page, err
		}
		var highWater int
		if err := tx.QueryRowContext(ctx, `SELECT pending_high_water FROM atheros_search.proxy_preparation_policy WHERE singleton AND expires_at > clock_timestamp()`).Scan(&highWater); err != nil {
			return page, fmt.Errorf("current Octopus queue policy unavailable: %w", err)
		}
		var pending int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM (SELECT job.job_id FROM atheros_search.embedding_jobs job
          JOIN atheros_search.search_documents doc ON doc.document_id=job.document_id
          WHERE doc.source_kind IN ('proxy_event','proxy_blocked_host_window') AND job.status IN ('pending','leased') LIMIT $1) bounded`, highWater).Scan(&pending); err != nil {
			return page, err
		}
		if len(ids) > highWater-pending {
			return page, fmt.Errorf("proxy queue headroom insufficient; retry the same page after workers drain")
		}
		for _, id := range ids {
			if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended(jsonb_build_array(doc.source_table,doc.source_key)::text,0))
              FROM atheros_search.search_documents doc JOIN atheros_search.embedding_jobs job ON job.document_id=doc.document_id WHERE job.job_id=$1`, id); err != nil {
				return page, err
			}
			result, err := tx.ExecContext(ctx, `WITH receipt AS (
              INSERT INTO atheros_search.embedding_repair_receipts(receipt_id,job_id,previous_status,attempt_count,previous_error,reason)
              SELECT gen_random_uuid(),job.job_id,job.status,job.attempt_count,job.last_error,'completed_missing_current_vector'
              FROM atheros_search.embedding_jobs job JOIN atheros_search.search_documents doc ON doc.document_id=job.document_id
              WHERE job.job_id=$1 AND job.status='completed' AND job.attempt_count<job.max_attempts
                AND doc.status='active' AND doc.normalized_sha256=job.content_sha256 AND doc.input_revision=job.input_revision
                AND doc.normalized_sha256=encode(sha256(convert_to(doc.normalized_text,'UTF8')),'hex')
                AND NOT EXISTS(SELECT 1 FROM atheros_search.embeddings unified
                  JOIN atheros_search.search_vectors_event per_kind ON per_kind.document_id=unified.document_id
                    AND per_kind.embedding_model=unified.embedding_model AND per_kind.input_revision=unified.input_revision
                    AND per_kind.content_sha256=unified.content_sha256 AND per_kind.embedding::text=unified.embedding::text
                  WHERE unified.document_id=job.document_id AND unified.embedding_model=job.embedding_model
                    AND unified.input_revision=job.input_revision AND unified.embedding_kind='event'
                    AND unified.content_sha256=job.content_sha256 AND unified.embedding OPERATOR(public.<#>) unified.embedding<0)
              RETURNING job_id)
              UPDATE atheros_search.embedding_jobs job SET status='pending', completed_at=NULL, next_attempt_at=clock_timestamp(), updated_at=clock_timestamp()
              FROM receipt WHERE job.job_id=receipt.job_id`, id)
			if err != nil {
				return page, err
			}
			n, err := result.RowsAffected()
			if err != nil {
				return page, err
			}
			page.Retried += n
		}
		if page.AfterJobID == "" {
			page.AfterJobID = scope.AfterJobID
		}
		var cursor any
		if page.AfterJobID != "" {
			cursor = page.AfterJobID
		}
		if _, err := tx.ExecContext(ctx, `UPDATE atheros_search.embedding_repair_progress SET after_job_id=$1,
          scanned=scanned+$2,finished_at=CASE WHEN $2=0 THEN clock_timestamp() ELSE NULL END,updated_at=clock_timestamp() WHERE campaign_id=$3`, cursor, page.Scanned, scope.CampaignID); err != nil {
			return page, err
		}
	}
	return page, tx.Commit()
}
