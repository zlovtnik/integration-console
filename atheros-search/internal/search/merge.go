package search

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// MergeDecision is a durable operator decision for a pending identity candidate.
type MergeDecision string

const (
	MergeDecisionMerge         MergeDecision = "merge"
	MergeDecisionNotMatch      MergeDecision = "not_match"
	MergeDecisionNeedsMoreData MergeDecision = "needs_more_data"
)

type MergeDecisionResponse struct {
	CandidateID string        `json:"candidate_id"`
	Decision    MergeDecision `json:"decision"`
	Accepted    bool          `json:"accepted"`
	DecidedBy   string        `json:"decided_by,omitempty"`
	DecidedAt   time.Time     `json:"decided_at"`
}

// MergeDecision persists an operator decision. Decisions are final; there is
// no undo endpoint. The subject is the Keycloak identity (or static-token).
func (s *Service) MergeDecision(ctx context.Context, candidateID string, decision string, subject string) (*MergeDecisionResponse, error) {
	candidateID = strings.TrimSpace(candidateID)
	if candidateID == "" {
		return nil, errors.New("candidate_id is required")
	}
	normalized, err := normalizeMergeDecision(decision)
	if err != nil {
		return nil, err
	}
	subject = strings.TrimSpace(subject)
	if subject == "" {
		subject = "auth-disabled"
	}

	tx, err := s.Pool.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var status string
	err = tx.QueryRowContext(ctx, `
SELECT status FROM atheros_search.merge_candidates
WHERE candidate_id = $1
FOR UPDATE`, candidateID).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("merge candidate not found")
	}
	if err != nil {
		return nil, err
	}

	var existingDecision string
	err = tx.QueryRowContext(ctx, `
SELECT decision FROM atheros_search.merge_decisions
WHERE candidate_id = $1`, candidateID).Scan(&existingDecision)
	if err == nil {
		return nil, fmt.Errorf("merge candidate already decided")
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	now := time.Now().UTC()
	if _, err := tx.ExecContext(ctx, `
INSERT INTO atheros_search.merge_decisions (candidate_id, decision, decided_at, decided_by)
VALUES ($1, $2, $3, $4)`, candidateID, string(normalized), now, subject); err != nil {
		return nil, err
	}

	newStatus := "decided"
	switch normalized {
	case MergeDecisionMerge:
		newStatus = "approved"
	case MergeDecisionNotMatch:
		newStatus = "rejected"
	case MergeDecisionNeedsMoreData:
		newStatus = "deferred"
	}
	if _, err := tx.ExecContext(ctx, `
UPDATE atheros_search.merge_candidates
SET status = $2, updated_at = CURRENT_TIMESTAMP
WHERE candidate_id = $1`, candidateID, newStatus); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return &MergeDecisionResponse{
		CandidateID: candidateID,
		Decision:    normalized,
		Accepted:    true,
		DecidedBy:   subject,
		DecidedAt:   now,
	}, nil
}

func normalizeMergeDecision(value string) (MergeDecision, error) {
	switch MergeDecision(strings.TrimSpace(value)) {
	case MergeDecisionMerge:
		return MergeDecisionMerge, nil
	case MergeDecisionNotMatch:
		return MergeDecisionNotMatch, nil
	case MergeDecisionNeedsMoreData:
		return MergeDecisionNeedsMoreData, nil
	case "undo_merge":
		return "", fmt.Errorf("unsupported merge decision %q", value)
	case "":
		return "", fmt.Errorf("unsupported merge decision %q", value)
	default:
		return "", fmt.Errorf("unsupported merge decision %q", value)
	}
}
