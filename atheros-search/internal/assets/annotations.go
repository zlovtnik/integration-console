package assets

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/apperror"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/queryscope"
)

var ErrAnnotationConflict = apperror.New(apperror.ErrConflict, "asset annotation revision conflict")

type AssetAnnotation struct {
	Kind      string    `json:"kind"`
	ID        string    `json:"id"`
	Role      string    `json:"role,omitempty"`
	Label     string    `json:"label,omitempty"`
	Pinned    bool      `json:"pinned"`
	Revision  int64     `json:"revision"`
	UpdatedBy string    `json:"updated_by,omitempty"`
	UpdatedAt time.Time `json:"updated_at"`
}

type AssetAnnotationUpdate struct {
	Role             *string `json:"role"`
	Label            *string `json:"label"`
	Pinned           *bool   `json:"pinned"`
	ExpectedRevision int64   `json:"expected_revision"`
}

func normalizeAssetID(kind, id string) (string, string, error) {
	kind = strings.ToLower(strings.TrimSpace(kind))
	id = strings.ToLower(strings.TrimSpace(id))
	if kind != "ap" && kind != "device" {
		return "", "", apperror.Validationf("unsupported asset annotation kind")
	}
	if !queryscope.MacPattern.MatchString(id) {
		return "", "", apperror.Validationf("asset annotation id must be a MAC address")
	}
	return kind, id, nil
}

func normalizeAnnotationUpdate(update AssetAnnotationUpdate) (AssetAnnotationUpdate, error) {
	if update.ExpectedRevision < 0 {
		return update, apperror.Validationf("expected_revision must not be negative")
	}
	if update.Role != nil {
		value := strings.ToLower(strings.TrimSpace(*update.Role))
		if value != "" && value != "router" && value != "server" {
			return update, apperror.Validationf("asset role must be router or server")
		}
		update.Role = &value
	}
	if update.Label != nil {
		value := strings.TrimSpace(*update.Label)
		if len(value) > 256 {
			return update, apperror.Validationf("asset label exceeds 256 characters")
		}
		update.Label = &value
	}
	if update.Role == nil && update.Label == nil && update.Pinned == nil {
		return update, apperror.Validationf("asset annotation requires role, label, or pinned")
	}
	return update, nil
}

func (s *Service) AssetAnnotation(ctx context.Context, kind, id string) (*AssetAnnotation, error) {
	kind, id, err := normalizeAssetID(kind, id)
	if err != nil {
		return nil, err
	}
	annotation := &AssetAnnotation{Kind: kind, ID: id}
	err = s.Pool.QueryRowContext(ctx, `
SELECT COALESCE(role, ''), COALESCE(label, ''), pinned, revision, updated_by, updated_at
FROM atheros_search.asset_annotations
WHERE asset_kind=$1 AND asset_id=$2`, kind, id).Scan(
		&annotation.Role, &annotation.Label, &annotation.Pinned, &annotation.Revision,
		&annotation.UpdatedBy, &annotation.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return annotation, nil
}

// UpdateAssetAnnotation uses an explicit revision check in the same transaction
// as the audit insert. A static-token deployment has no end-user subject, so its
// audit actor remains the fixed, non-secret service identity.
func (s *Service) UpdateAssetAnnotation(ctx context.Context, kind, id string, update AssetAnnotationUpdate, actor string) (*AssetAnnotation, error) {
	kind, id, err := normalizeAssetID(kind, id)
	if err != nil {
		return nil, err
	}
	update, err = normalizeAnnotationUpdate(update)
	if err != nil {
		return nil, err
	}
	actor = strings.TrimSpace(actor)
	if actor == "" {
		actor = "static-token"
	}
	tx, err := s.Pool.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }() // Cleanup after the operation; Commit errors are returned and an already committed transaction needs no rollback.

	var current AssetAnnotation
	current.Kind, current.ID = kind, id
	err = tx.QueryRowContext(ctx, `
SELECT COALESCE(role, ''), COALESCE(label, ''), pinned, revision, updated_by, updated_at
FROM atheros_search.asset_annotations
WHERE asset_kind=$1 AND asset_id=$2
FOR UPDATE`, kind, id).Scan(
		&current.Role, &current.Label, &current.Pinned, &current.Revision,
		&current.UpdatedBy, &current.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		if update.ExpectedRevision != 0 {
			return nil, ErrAnnotationConflict
		}
		current.Revision = 0
		current.Role, current.Label, current.Pinned = "", "", false
	} else if err != nil {
		return nil, err
	} else if current.Revision != update.ExpectedRevision {
		return nil, ErrAnnotationConflict
	}
	if update.Role != nil {
		current.Role = *update.Role
	}
	if update.Label != nil {
		current.Label = *update.Label
	}
	if update.Pinned != nil {
		current.Pinned = *update.Pinned
	}
	if current.Role == "" && current.Label == "" && !current.Pinned {
		return nil, apperror.Validationf("asset annotation must retain a role, label, or pin")
	}
	current.Revision++
	current.UpdatedBy = actor
	err = tx.QueryRowContext(ctx, `
INSERT INTO atheros_search.asset_annotations (
  asset_kind, asset_id, role, label, pinned, revision, updated_by, updated_at
) VALUES ($1,$2,NULLIF($3,''),NULLIF($4,''),$5,$6,$7,CURRENT_TIMESTAMP)
ON CONFLICT (asset_kind, asset_id) DO UPDATE SET
  role=EXCLUDED.role, label=EXCLUDED.label, pinned=EXCLUDED.pinned,
  revision=EXCLUDED.revision, updated_by=EXCLUDED.updated_by, updated_at=EXCLUDED.updated_at
RETURNING updated_at`, kind, id, current.Role, current.Label, current.Pinned,
		current.Revision, current.UpdatedBy).Scan(&current.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("write asset annotation: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO atheros_search.asset_annotation_audit (
  asset_kind, asset_id, revision, role, label, pinned, actor
) VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,''),$6,$7)`, kind, id,
		current.Revision, current.Role, current.Label, current.Pinned, actor); err != nil {
		return nil, fmt.Errorf("audit asset annotation: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &current, nil
}
