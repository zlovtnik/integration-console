package search

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

func (s *Service) inventoryTablePage(ctx context.Context, filters InventoryFilters) (*InventoryResponse, error) {
	identity := filters
	identity.PageCursor = ""
	identity.PageSize = 0
	identity.Limit = 0
	fingerprint, err := pageFingerprint(identity)
	if err != nil {
		return nil, err
	}
	cursor, err := decodePageCursor(filters.PageCursor, "inventory-table", fingerprint)
	if err != nil {
		return nil, err
	}
	tx, err := s.Pool.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	where, args := inventoryPageWhere(filters, "d")
	var total, registered int
	var first, last sql.NullTime
	err = tx.QueryRowContext(ctx, `SELECT COUNT(*), COUNT(*) FILTER (WHERE d.registered), MIN(d.first_seen), MAX(d.last_seen)
 FROM atheros_search.devices d WHERE `+where, args...).Scan(&total, &registered, &first, &last)
	if err != nil {
		return nil, err
	}
	order := "d.last_seen DESC, d.mac ASC"
	if filters.Sort == "identifier" {
		order = "d.mac ASC"
	}
	if cursor.DeviceAfter != "" {
		if filters.Sort == "identifier" {
			where += fmt.Sprintf(" AND d.mac > $%d", len(args)+1)
			args = append(args, cursor.DeviceAfter)
		} else {
			after, err := time.Parse(time.RFC3339Nano, cursor.TimeAfter)
			if err != nil {
				return nil, fmt.Errorf("invalid page_cursor")
			}
			where += fmt.Sprintf(" AND (d.last_seen < $%d OR (d.last_seen = $%d AND d.mac > $%d))", len(args)+1, len(args)+1, len(args)+2)
			args = append(args, after, cursor.DeviceAfter)
		}
	}
	args = append(args, filters.PageSize+1)
	rows, err := tx.QueryContext(ctx, `SELECT d.mac, COALESCE(d.display_name,''), COALESCE(d.owner_id,''), COALESCE(d.location_id,''),
	d.first_registered, d.first_seen, d.last_seen, d.active, d.registered, d.tags::text, d.known_macs::text,
 NOT EXISTS (SELECT 1 FROM atheros_search.graph_edges ge
 WHERE ge.edge_kind = 'observed_at' AND ge.source_node_id = 'device:' || d.mac)
 FROM atheros_search.devices d WHERE `+where+` ORDER BY `+order+` LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, err
	}
	nodes := []InventoryNode{}
	for rows.Next() {
		var row inventoryDeviceRow
		var registeredAt, firstSeen, lastSeen sql.NullTime
		var tags, aliases string
		var noAPLink bool
		if err := rows.Scan(&row.MAC, &row.DisplayName, &row.OwnerID, &row.LocationID, &registeredAt, &firstSeen, &lastSeen, &row.Active, &row.Registered, &tags, &aliases, &noAPLink); err != nil {
			rows.Close()
			return nil, err
		}
		row.FirstRegistered = nullTimePtr(registeredAt)
		row.LastSeen = nullTimePtr(lastSeen)
		row.Tags = parseTagsJSON(tags)
		_ = json.Unmarshal([]byte(aliases), &row.KnownMACs)
		m := map[string]InventoryNode{}
		addInventoryDevice(m, map[string]InventoryEdge{}, row, InventoryGroupingRegistry)
		node := m["device:"+row.MAC]
		node.FirstSeen = nullTimePtr(firstSeen)
		node.NoAPLink = &noAPLink
		nodes = append(nodes, node)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	next := ""
	if len(nodes) > filters.PageSize {
		nodes = nodes[:filters.PageSize]
		end := nodes[len(nodes)-1]
		cursor.DeviceAfter = end.MAC
		cursor.TimeAfter = end.LastSeen.Format(time.RFC3339Nano)
		next, err = encodePageCursor(cursor)
		if err != nil {
			return nil, err
		}
	}
	if err := loadInventoryReviewCounts(ctx, tx, nodes); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	report := reportMetadata(identity, "observed MAC identifier", "distinct registry MACs matching the filters", "registry lifetime first/last observation; selected evidence scope establishes inclusion", len(nodes), &total)
	report.ObservationStart = nullTimePtr(first)
	report.ObservationEnd = nullTimePtr(last)
	zero := 0
	return &InventoryResponse{Nodes: nodes, Edges: []InventoryEdge{}, GeneratedAt: time.Now().UTC(), NodeCount: len(nodes), TotalRegisteredCount: registered,
		TotalDeviceCount: &total, TotalNodeCount: &total, TotalEdgeCount: &zero, NextPageCursor: next, Report: report}, nil
}

func loadInventoryReviewCounts(ctx context.Context, tx *sql.Tx, nodes []InventoryNode) error {
	if len(nodes) == 0 {
		return nil
	}
	macs := make([]any, 0, len(nodes))
	indices := make(map[string]int, len(nodes))
	for i, node := range nodes {
		macs = append(macs, node.MAC)
		indices[node.MAC] = i
		zero := 0
		nodes[i].PendingReviewCount = &zero
	}
	placeholders := pgPlaceholders(1, len(macs))
	rows, err := tx.QueryContext(ctx, `
WITH pending AS (
 SELECT mac_a AS mac FROM atheros_search.merge_candidates
 WHERE status='pending' AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP) AND mac_a IN (`+placeholders+`)
 UNION ALL
 SELECT mac_b AS mac FROM atheros_search.merge_candidates
 WHERE status='pending' AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP) AND mac_b IN (`+placeholders+`)
)
SELECT mac,COUNT(*) FROM pending GROUP BY mac`, macs...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var mac string
		var count int
		if err := rows.Scan(&mac, &count); err != nil {
			return err
		}
		if i, ok := indices[mac]; ok {
			nodes[i].PendingReviewCount = &count
		}
	}
	return rows.Err()
}
