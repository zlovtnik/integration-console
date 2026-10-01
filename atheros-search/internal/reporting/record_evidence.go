package reporting

import (
	"context"
	"database/sql"
	"time"
)

// RecordEvidence assembles the investigation projection within the record
// context's repeatable-read transaction. Its caller owns commit or rollback.
func (s *Service) RecordEvidence(ctx context.Context, tx *sql.Tx, request InvestigationRequest, response *InvestigationResponse, cutoff time.Time, includeRF bool) error {
	scope, args := InvestigationScope(request, "summary")
	if err := s.investigationRoster(ctx, tx, scope, args, request, response, cutoff); err != nil {
		return err
	}
	if err := s.investigationAssociationLinks(ctx, tx, request, response, cutoff); err != nil {
		return err
	}
	if err := s.investigationTypedLinks(ctx, tx, request, response, cutoff); err != nil {
		return err
	}
	if includeRF {
		return s.investigationRFSimilarityLinks(ctx, tx, request, response, cutoff)
	}
	return nil
}

func (r *InvestigationResponse) RFProximityReason() string { return r.rfProximityReason }
