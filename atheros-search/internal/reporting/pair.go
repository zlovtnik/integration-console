package reporting

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/apperror"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/queryscope"
)

type PairDetail struct {
	CandidateID     string          `json:"candidate_id"`
	MACA            string          `json:"mac_a"`
	MACB            string          `json:"mac_b"`
	Confidence      float64         `json:"confidence"`
	ComputedAt      time.Time       `json:"computed_at"`
	Status          string          `json:"status"`
	Evidence        json.RawMessage `json:"evidence"`
	ProjectionRunID string          `json:"projection_run_id"`
	Decision        string          `json:"decision,omitempty"`
	DecidedBy       string          `json:"decided_by,omitempty"`
	DecidedAt       *time.Time      `json:"decided_at,omitempty"`
	Devices         []InventoryNode `json:"devices"`
}

// PairDetail is independent of graph pages and retains recorded provenance.
func (s *Service) PairDetail(ctx context.Context, id string) (*PairDetail, error) {
	if strings.TrimSpace(id) == "" {
		return nil, apperror.Validationf("candidate_id is required")
	}
	tx, err := s.Pool.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }() // Cleanup after the operation; Commit errors are returned and an already committed transaction needs no rollback.
	detail := &PairDetail{Devices: []InventoryNode{}}
	var evidence string
	var decision, subject sql.NullString
	var decided sql.NullTime
	err = tx.QueryRowContext(ctx, `SELECT mc.candidate_id, mc.mac_a, mc.mac_b, mc.confidence,
 mc.computed_at, mc.status, mc.evidence::text, mc.projection_run_id,
 md.decision, md.decided_by, md.decided_at
 FROM atheros_search.merge_candidates mc
 LEFT JOIN atheros_search.merge_decisions md ON md.candidate_id = mc.candidate_id
 WHERE mc.candidate_id = $1`, id).Scan(&detail.CandidateID, &detail.MACA, &detail.MACB, &detail.Confidence,
		&detail.ComputedAt, &detail.Status, &evidence, &detail.ProjectionRunID, &decision, &subject, &decided)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apperror.New(apperror.ErrNotFound, "merge candidate not found")
	}
	if err != nil {
		return nil, err
	}
	detail.Evidence = json.RawMessage(evidence)
	detail.Decision = decision.String
	detail.DecidedBy = subject.String
	detail.DecidedAt = queryscope.NullTimePtr(decided)
	rows, err := tx.QueryContext(ctx, `SELECT mac, COALESCE(display_name, ''), COALESCE(owner_id, ''), COALESCE(location_id, ''),
 first_registered, last_seen, active, registered, COALESCE(tags::text, '[]'), COALESCE(known_macs::text, '[]')
 FROM atheros_search.devices WHERE mac IN ($1, $2) ORDER BY mac`, detail.MACA, detail.MACB)
	if err != nil {
		return nil, err
	}
	nodes := map[string]InventoryNode{}
	for rows.Next() {
		var row inventoryDeviceRow
		var first, last sql.NullTime
		var tags, macs string
		if err := rows.Scan(&row.MAC, &row.DisplayName, &row.OwnerID, &row.LocationID, &first, &last, &row.Active, &row.Registered, &tags, &macs); err != nil {
			_ = rows.Close() // Preserve the primary scan/iteration error; Close is checked on the successful path.
			return nil, err
		}
		row.FirstRegistered = queryscope.NullTimePtr(first)
		row.LastSeen = queryscope.NullTimePtr(last)
		row.Tags = queryscope.ParseTagsJSON(tags)
		_ = json.Unmarshal([]byte(macs), &row.KnownMACs)
		addInventoryDevice(nodes, map[string]InventoryEdge{}, row, InventoryGroupingRegistry)
		detail.Devices = append(detail.Devices, nodes["device:"+row.MAC])
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close() // Preserve the primary scan/iteration error; Close is checked on the successful path.
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return detail, nil
}
