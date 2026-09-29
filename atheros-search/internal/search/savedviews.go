package search

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgconn"
)

const (
	// SavedViewSurfaceGraphProjection is the only supported saved-view surface.
	SavedViewSurfaceGraphProjection = "graph_projection"
	// SavedViewVersion is the contract version of the stored view state.
	SavedViewVersion = 1
	// SavedViewMaxNameLength bounds a trimmed view name in characters.
	SavedViewMaxNameLength = 80
	// SavedViewMaxPerUser bounds saved views per owner and surface.
	SavedViewMaxPerUser = 20
)

var (
	// ErrSavedViewNotFound is returned for absent or foreign-owned view IDs.
	ErrSavedViewNotFound = errors.New("saved view not found")
	// ErrSavedViewDuplicateName is returned for case-insensitive name clashes.
	ErrSavedViewDuplicateName = errors.New("saved view name already exists")
	// ErrSavedViewStaleRevision is returned when expected_revision is stale.
	ErrSavedViewStaleRevision = errors.New("saved view revision conflict")
	// ErrSavedViewLimitReached is returned when the per-user limit is full.
	ErrSavedViewLimitReached = errors.New("saved view limit reached")
	// ErrSavedViewUnavailable is returned when the deployment has no stable
	// user identity (static-token or auth-disabled mode).
	ErrSavedViewUnavailable = errors.New("saved views require a signed-in user")
)

var savedViewIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

var savedViewNodeKinds = map[string]struct{}{
	"device": {}, "cluster": {}, "ap": {}, "client": {}, "shadow_alert": {}, "alert": {},
}

var savedViewEdgeKinds = map[string]struct{}{
	"association": {}, "cluster_member": {}, "roaming": {}, "same_channel": {},
	"vendor_link": {}, "rf_proximity": {}, "probe": {}, "shadow": {}, "alert_ref": {},
}

// SavedViewState is the versioned payload of a saved graph view.
type SavedViewState struct {
	GraphFilters     GraphFilters `json:"filters"`
	VisibleNodeKinds []string     `json:"visible_node_kinds,omitempty"`
	VisibleEdgeKinds []string     `json:"visible_edge_kinds,omitempty"`
}

// SavedGraphView is the versioned saved-view contract.
type SavedGraphView struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Surface     string         `json:"surface"`
	ViewVersion int            `json:"view_version"`
	Revision    int64          `json:"revision"`
	State       SavedViewState `json:"state"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

// SavedViewCreate is the create payload; surface is fixed by the route.
type SavedViewCreate struct {
	Name  string         `json:"name"`
	State SavedViewState `json:"state"`
}

// SavedViewUpdate is the update payload with optimistic concurrency.
type SavedViewUpdate struct {
	Name             string         `json:"name"`
	State            SavedViewState `json:"state"`
	ExpectedRevision int64          `json:"expected_revision"`
}

func requireSavedViewOwner(owner string) error {
	if strings.TrimSpace(owner) == "" {
		return ErrSavedViewUnavailable
	}
	return nil
}

func normalizeSavedViewSurface(surface string) (string, error) {
	surface = strings.TrimSpace(surface)
	if surface == "" {
		return SavedViewSurfaceGraphProjection, nil
	}
	if surface != SavedViewSurfaceGraphProjection {
		return "", fmt.Errorf("unsupported saved view surface %q", surface)
	}
	return surface, nil
}

func normalizeSavedViewName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > SavedViewMaxNameLength {
		return "", fmt.Errorf("invalid saved view name: must be 1 to %d characters", SavedViewMaxNameLength)
	}
	return name, nil
}

func normalizeSavedViewKinds(values []string, vocabulary map[string]struct{}, label string) ([]string, error) {
	normalized := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := vocabulary[value]; !ok {
			return nil, fmt.Errorf("invalid saved view state: unsupported %s %q", label, value)
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		normalized = append(normalized, value)
	}
	return normalized, nil
}

func normalizeSavedViewState(state SavedViewState) (SavedViewState, error) {
	filters, err := normalizeGraphFilters(state.GraphFilters)
	if err != nil {
		return state, fmt.Errorf("invalid saved view state: %s", err.Error())
	}
	filters.PageCursor = ""
	filters.PageSize = 0
	filters.Kinds, err = normalizeSavedViewKinds(filters.Kinds, savedViewNodeKinds, "node kind")
	if err != nil {
		return state, err
	}
	filters.EdgeKinds, err = normalizeSavedViewKinds(filters.EdgeKinds, savedViewEdgeKinds, "edge kind")
	if err != nil {
		return state, err
	}
	state.GraphFilters = filters
	state.VisibleNodeKinds, err = normalizeSavedViewKinds(state.VisibleNodeKinds, savedViewNodeKinds, "visible node kind")
	if err != nil {
		return state, err
	}
	state.VisibleEdgeKinds, err = normalizeSavedViewKinds(state.VisibleEdgeKinds, savedViewEdgeKinds, "visible edge kind")
	if err != nil {
		return state, err
	}
	return state, nil
}

func isSavedViewDuplicate(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

const savedViewColumns = "id, name, surface, view_version, revision, state, created_at, updated_at"

func scanSavedView(scanner interface{ Scan(dest ...any) error }) (*SavedGraphView, error) {
	view := &SavedGraphView{}
	var raw []byte
	if err := scanner.Scan(&view.ID, &view.Name, &view.Surface, &view.ViewVersion,
		&view.Revision, &raw, &view.CreatedAt, &view.UpdatedAt); err != nil {
		return nil, err
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &view.State); err != nil {
			return nil, fmt.Errorf("decode saved view state: %w", err)
		}
	}
	return view, nil
}

// ListSavedViews returns the owner's saved views for one surface, ordered by
// case-insensitive name. The owner subject never leaves this query.
func (s *Service) ListSavedViews(ctx context.Context, owner, surface string) ([]SavedGraphView, error) {
	if err := requireSavedViewOwner(owner); err != nil {
		return nil, err
	}
	surface, err := normalizeSavedViewSurface(surface)
	if err != nil {
		return nil, err
	}
	rows, err := s.Pool.QueryContext(ctx, `
SELECT `+savedViewColumns+`
FROM atheros_search.saved_views
WHERE owner_subject=$1 AND surface=$2
ORDER BY lower(name), id`, owner, surface)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	views := make([]SavedGraphView, 0)
	for rows.Next() {
		view, err := scanSavedView(rows)
		if err != nil {
			return nil, err
		}
		views = append(views, *view)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return views, nil
}

// CreateSavedView stores a new personal view after enforcing the per-user
// limit and case-insensitive name uniqueness.
func (s *Service) CreateSavedView(ctx context.Context, owner string, input SavedViewCreate) (*SavedGraphView, error) {
	if err := requireSavedViewOwner(owner); err != nil {
		return nil, err
	}
	name, err := normalizeSavedViewName(input.Name)
	if err != nil {
		return nil, err
	}
	state, err := normalizeSavedViewState(input.State)
	if err != nil {
		return nil, err
	}
	payload, err := json.Marshal(state)
	if err != nil {
		return nil, fmt.Errorf("encode saved view state: %w", err)
	}

	tx, err := s.Pool.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var count int
	if err := tx.QueryRowContext(ctx, `
SELECT count(*)
FROM atheros_search.saved_views
WHERE owner_subject=$1 AND surface=$2`, owner, SavedViewSurfaceGraphProjection).Scan(&count); err != nil {
		return nil, err
	}
	if count >= SavedViewMaxPerUser {
		return nil, ErrSavedViewLimitReached
	}
	if err := requireSavedViewNameFree(ctx, tx, owner, SavedViewSurfaceGraphProjection, name, ""); err != nil {
		return nil, err
	}

	view, err := scanSavedView(tx.QueryRowContext(ctx, `
INSERT INTO atheros_search.saved_views (owner_subject, surface, name, view_version, state, revision)
VALUES ($1,$2,$3,$4,$5,1)
RETURNING `+savedViewColumns, owner, SavedViewSurfaceGraphProjection, name, SavedViewVersion, payload))
	if err != nil {
		if isSavedViewDuplicate(err) {
			return nil, ErrSavedViewDuplicateName
		}
		return nil, fmt.Errorf("insert saved view: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return view, nil
}

// UpdateSavedView applies name and state changes with an explicit revision
// check. Views that do not exist for this owner surface as not found.
func (s *Service) UpdateSavedView(ctx context.Context, owner, id string, input SavedViewUpdate) (*SavedGraphView, error) {
	if err := requireSavedViewOwner(owner); err != nil {
		return nil, err
	}
	if !savedViewIDPattern.MatchString(strings.TrimSpace(id)) {
		return nil, ErrSavedViewNotFound
	}
	name, err := normalizeSavedViewName(input.Name)
	if err != nil {
		return nil, err
	}
	if input.ExpectedRevision < 0 {
		return nil, fmt.Errorf("invalid saved view: expected_revision must not be negative")
	}
	state, err := normalizeSavedViewState(input.State)
	if err != nil {
		return nil, err
	}
	payload, err := json.Marshal(state)
	if err != nil {
		return nil, fmt.Errorf("encode saved view state: %w", err)
	}
	id = strings.ToLower(strings.TrimSpace(id))

	tx, err := s.Pool.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var currentName string
	var currentRevision int64
	err = tx.QueryRowContext(ctx, `
SELECT name, revision
FROM atheros_search.saved_views
WHERE id=$1 AND owner_subject=$2
FOR UPDATE`, id, owner).Scan(&currentName, &currentRevision)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSavedViewNotFound
	}
	if err != nil {
		return nil, err
	}
	if currentRevision != input.ExpectedRevision {
		return nil, ErrSavedViewStaleRevision
	}
	if !strings.EqualFold(currentName, name) {
		if err := requireSavedViewNameFree(ctx, tx, owner, SavedViewSurfaceGraphProjection, name, id); err != nil {
			return nil, err
		}
	}

	view, err := scanSavedView(tx.QueryRowContext(ctx, `
UPDATE atheros_search.saved_views
SET name=$3, state=$4, revision=revision+1, updated_at=CURRENT_TIMESTAMP
WHERE id=$1 AND owner_subject=$2
RETURNING `+savedViewColumns, id, owner, name, payload))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSavedViewNotFound
	}
	if err != nil {
		if isSavedViewDuplicate(err) {
			return nil, ErrSavedViewDuplicateName
		}
		return nil, fmt.Errorf("update saved view: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return view, nil
}

// DeleteSavedView removes an owned view; foreign or absent IDs are 404.
func (s *Service) DeleteSavedView(ctx context.Context, owner, id string) error {
	if err := requireSavedViewOwner(owner); err != nil {
		return err
	}
	if !savedViewIDPattern.MatchString(strings.TrimSpace(id)) {
		return ErrSavedViewNotFound
	}
	id = strings.ToLower(strings.TrimSpace(id))
	result, err := s.Pool.ExecContext(ctx, `
DELETE FROM atheros_search.saved_views
WHERE id=$1 AND owner_subject=$2`, id, owner)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrSavedViewNotFound
	}
	return nil
}

func requireSavedViewNameFree(ctx context.Context, tx *sql.Tx, owner, surface, name, excludeID string) error {
	var existingID string
	err := tx.QueryRowContext(ctx, `
SELECT id::text
FROM atheros_search.saved_views
WHERE owner_subject=$1 AND surface=$2 AND lower(name)=lower($3)
  AND ($4::uuid IS NULL OR id <> $4::uuid)
LIMIT 1`, owner, surface, name, excludeIDOrNull(excludeID)).Scan(&existingID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	return ErrSavedViewDuplicateName
}

func excludeIDOrNull(excludeID string) any {
	if excludeID == "" {
		return nil
	}
	return excludeID
}
