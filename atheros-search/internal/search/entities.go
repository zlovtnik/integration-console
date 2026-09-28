package search

import (
	"context"
	"fmt"
	"strings"
	"time"
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
		return nil, fmt.Errorf("entity kind must be ap or device")
	}
	query = strings.ToLower(strings.TrimSpace(query))
	if pageSize <= 0 {
		pageSize = 12
	}
	if pageSize > 50 {
		pageSize = 50
	}
	cursor = strings.ToLower(strings.TrimSpace(cursor))
	if cursor != "" && !macPattern.MatchString(cursor) {
		return nil, fmt.Errorf("invalid entity page_cursor")
	}
	args := []any{query}
	where := ""
	if kind == "ap" {
		where = "($1='' OR catalog.bssid LIKE $2 OR lower(COALESCE(catalog.authorized_label,'')) LIKE $2)"
		args = append(args, escapeLike(query)+"%")
		if cursor != "" {
			where += fmt.Sprintf(" AND catalog.bssid > $%d", len(args)+1)
			args = append(args, cursor)
		}
		args = append(args, pageSize+1)
		rows, err := s.Pool.QueryContext(ctx, `
SELECT catalog.bssid, COALESCE(annotation.label, catalog.authorized_label, catalog.bssid),
       COALESCE(annotation.pinned,FALSE), COALESCE(annotation.role,''), catalog.authorized,
       catalog.last_observed_at
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
		defer rows.Close()
		return scanEntityChoices(rows, kind, pageSize)
	}
	where = "($1='' OR device.mac LIKE $2 OR lower(COALESCE(device.display_name,'')) LIKE $2 OR lower(COALESCE(annotation.label,'')) LIKE $2)"
	args = append(args, escapeLike(query)+"%")
	if cursor != "" {
		where += fmt.Sprintf(" AND device.mac > $%d", len(args)+1)
		args = append(args, cursor)
	}
	args = append(args, pageSize+1)
	rows, err := s.Pool.QueryContext(ctx, `
SELECT device.mac, COALESCE(annotation.label, NULLIF(device.display_name,''), device.mac),
       COALESCE(annotation.pinned,FALSE), COALESCE(annotation.role,''), FALSE, device.last_seen
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
	defer rows.Close()
	return scanEntityChoices(rows, kind, pageSize)
}

type entityRows interface {
	Next() bool
	Scan(...any) error
	Err() error
}

func scanEntityChoices(rows entityRows, kind string, pageSize int) (*EntitiesResponse, error) {
	response := &EntitiesResponse{Entities: []EntityChoice{}}
	for rows.Next() {
		var entity EntityChoice
		entity.Kind = kind
		if err := rows.Scan(&entity.ID, &entity.Label, &entity.Pinned, &entity.Role, &entity.Authorized, &entity.LastSeen); err != nil {
			return nil, err
		}
		response.Entities = append(response.Entities, entity)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(response.Entities) > pageSize {
		response.Entities = response.Entities[:pageSize]
		response.NextPageCursor = response.Entities[len(response.Entities)-1].ID
	}
	return response, nil
}
