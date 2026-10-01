package assets

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/apperror"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/queryscope"
)

type EntityChoice struct {
	Kind       string     `json:"kind"`
	ID         string     `json:"id"`
	Label      string     `json:"label"`
	Pinned     bool       `json:"pinned"`
	Role       string     `json:"role,omitempty"`
	Authorized bool       `json:"authorized,omitempty"`
	LastSeen   *time.Time `json:"last_seen,omitempty"`
}

type EntitiesResponse struct {
	Entities       []EntityChoice `json:"entities"`
	NextPageCursor string         `json:"next_page_cursor,omitempty"`
}

// Entities provides small, stable choices for URL-backed report controls. A
// client receives twelve useful defaults and can continue with typeahead; it
// never needs to load the whole inventory to populate a select element.
func (s *Service) Entities(ctx context.Context, kind, query, cursor string, pageSize int) (*EntitiesResponse, error) {
	kind = strings.ToLower(strings.TrimSpace(kind))
	if kind != "ap" && kind != "device" {
		return nil, apperror.Validationf("entity kind must be ap or device")
	}
	query = strings.ToLower(strings.TrimSpace(query))
	if pageSize <= 0 {
		pageSize = 12
	}
	if pageSize > 50 {
		pageSize = 50
	}
	var after entityCursor
	if cursor != "" {
		data, err := base64.RawURLEncoding.DecodeString(cursor)
		if err != nil || json.Unmarshal(data, &after) != nil || after.Kind != kind || after.Query != query || !queryscope.MacPattern.MatchString(after.ID) {
			return nil, apperror.Validationf("invalid entity page_cursor")
		}
	}
	args := []any{query}
	where := ""
	if kind == "ap" {
		where = "($1='' OR catalog.bssid LIKE $2 OR lower(COALESCE(catalog.authorized_label,'')) LIKE $2)"
		args = append(args, queryscope.EscapeLike(query)+"%")
		if cursor != "" {
			where += entityAfterSQL("catalog.authorized", "catalog.last_observed_at", "catalog.bssid")
			args = append(args, after.Pinned, after.Ranked, after.LastSeen, after.ID)
		}
		args = append(args, pageSize+1)
		// #nosec G202 -- where uses fixed SQL clauses and numbered placeholders; all request values are bound in args.
		rows, err := s.Pool.QueryContext(ctx, `
SELECT catalog.bssid, COALESCE(annotation.label, catalog.authorized_label, catalog.bssid),
       COALESCE(annotation.pinned,FALSE), COALESCE(annotation.role,''), catalog.authorized,
		       catalog.last_observed_at, catalog.authorized
FROM atheros_search.ap_catalog catalog
LEFT JOIN atheros_search.asset_annotations annotation
  ON annotation.asset_kind='ap' AND annotation.asset_id=catalog.bssid
WHERE `+where+`
ORDER BY COALESCE(annotation.pinned,FALSE) DESC, catalog.authorized DESC,
         catalog.last_observed_at DESC, catalog.bssid ASC
LIMIT $`+fmt.Sprint(len(args)), args...)
		if err != nil {
			return nil, err
		}
		defer func() { _ = rows.Close() }() // Release resources on early return; query, scan, and iteration errors are checked separately.
		return scanEntityChoices(rows, kind, query, pageSize)
	}
	where = "($1='' OR device.mac LIKE $2 OR lower(COALESCE(device.display_name,'')) LIKE $2 OR lower(COALESCE(annotation.label,'')) LIKE $2)"
	args = append(args, queryscope.EscapeLike(query)+"%")
	if cursor != "" {
		where += entityAfterSQL("device.registered", "device.last_seen", "device.mac")
		args = append(args, after.Pinned, after.Ranked, after.LastSeen, after.ID)
	}
	args = append(args, pageSize+1)
	// #nosec G202 -- where uses fixed SQL clauses and numbered placeholders; all request values are bound in args.
	rows, err := s.Pool.QueryContext(ctx, `
SELECT device.mac, COALESCE(annotation.label, NULLIF(device.display_name,''), device.mac),
       COALESCE(annotation.pinned,FALSE), COALESCE(annotation.role,''), FALSE, device.last_seen, device.registered
FROM atheros_search.devices device
LEFT JOIN atheros_search.asset_annotations annotation
  ON annotation.asset_kind='device' AND annotation.asset_id=device.mac
WHERE `+where+`
ORDER BY COALESCE(annotation.pinned,FALSE) DESC, device.registered DESC,
         device.last_seen DESC, device.mac ASC
LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }() // Release resources on early return; query, scan, and iteration errors are checked separately.
	return scanEntityChoices(rows, kind, query, pageSize)
}

// Cursors retain every ordering component. DESC timestamps keep PostgreSQL's
// NULLS FIRST ordering, while the final ID tie-breaker is ascending.
type entityCursor struct {
	Kind     string     `json:"kind"`
	Query    string     `json:"query"`
	ID       string     `json:"id"`
	Pinned   bool       `json:"pinned"`
	Ranked   bool       `json:"ranked"`
	LastSeen *time.Time `json:"last_seen"`
}

func entityAfterSQL(rank, seen, id string) string {
	return fmt.Sprintf(` AND (
  COALESCE(annotation.pinned,FALSE) < $3 OR
  (COALESCE(annotation.pinned,FALSE) = $3 AND %s < $4) OR
  (COALESCE(annotation.pinned,FALSE) = $3 AND %s = $4 AND
    (($5::timestamptz IS NULL AND %s IS NOT NULL) OR %s < $5::timestamptz)) OR
  (COALESCE(annotation.pinned,FALSE) = $3 AND %s = $4 AND
    %s IS NOT DISTINCT FROM $5::timestamptz AND %s > $6))`, rank, rank, seen, seen, rank, seen, id)
}

type entityRows interface {
	Next() bool
	Scan(...any) error
	Err() error
}

func scanEntityChoices(rows entityRows, kind, query string, pageSize int) (*EntitiesResponse, error) {
	response := &EntitiesResponse{Entities: []EntityChoice{}}
	var last entityCursor
	for rows.Next() {
		var entity EntityChoice
		entity.Kind = kind
		var ranked bool
		if err := rows.Scan(&entity.ID, &entity.Label, &entity.Pinned, &entity.Role, &entity.Authorized, &entity.LastSeen, &ranked); err != nil {
			return nil, err
		}
		response.Entities = append(response.Entities, entity)
		if len(response.Entities) == pageSize {
			last = entityCursor{Kind: kind, Query: query, ID: entity.ID, Pinned: entity.Pinned, Ranked: ranked, LastSeen: entity.LastSeen}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(response.Entities) > pageSize {
		response.Entities = response.Entities[:pageSize]
		data, err := json.Marshal(last)
		if err != nil {
			return nil, err
		}
		response.NextPageCursor = base64.RawURLEncoding.EncodeToString(data)
	}
	return response, nil
}
