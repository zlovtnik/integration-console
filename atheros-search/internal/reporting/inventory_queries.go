package reporting

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/queryscope"
)

func fetchInventoryDevices(ctx context.Context, tx *sql.Tx, filters InventoryFilters) ([]inventoryDeviceRow, error) {
	where, args := inventoryPageWhere(filters, "devices")
	clauses := []string{where}
	devices := make([]inventoryDeviceRow, 0, filters.Limit)
	var cursorLastSeen time.Time
	var cursorMAC string
	for len(devices) < filters.Limit {
		pageClauses := append([]string(nil), clauses...)
		pageArgs := append([]any(nil), args...)
		if !cursorLastSeen.IsZero() {
			pageClauses = append(pageClauses, fmt.Sprintf("(last_seen < $%d OR (last_seen = $%d AND mac > $%d))", len(pageArgs)+1, len(pageArgs)+1, len(pageArgs)+2))
			pageArgs = append(pageArgs, cursorLastSeen, cursorMAC)
		}
		pageArgs = append(pageArgs, filters.Limit)
		// #nosec G202 -- SQL fragments contain fixed clauses and placeholders; values are bound in args.
		rows, err := tx.QueryContext(ctx, `
SELECT
  mac, COALESCE(display_name, ''), COALESCE(owner_id, ''), COALESCE(location_id, ''),
  first_registered, last_seen, active, registered,
  COALESCE(tags::text, '[]'), COALESCE(known_macs::text, '[]')
FROM atheros_search.devices
WHERE `+strings.Join(pageClauses, " AND ")+`
ORDER BY last_seen DESC, mac ASC
		LIMIT $`+fmt.Sprint(len(pageArgs)), pageArgs...)
		if err != nil {
			return nil, err
		}
		pageRows := 0
		for rows.Next() {
			var row inventoryDeviceRow
			var first, last sql.NullTime
			var tagsJSON, knownMACsJSON string
			if err := rows.Scan(
				&row.MAC, &row.DisplayName, &row.OwnerID, &row.LocationID,
				&first, &last, &row.Active, &row.Registered,
				&tagsJSON, &knownMACsJSON,
			); err != nil {
				_ = rows.Close()
				return nil, err
			}
			pageRows++
			cursorLastSeen = last.Time
			cursorMAC = row.MAC
			row.FirstRegistered = queryscope.NullTimePtr(first)
			row.LastSeen = queryscope.NullTimePtr(last)
			row.Tags = queryscope.ParseTagsJSON(tagsJSON)
			_ = json.Unmarshal([]byte(knownMACsJSON), &row.KnownMACs)
			row.Tags = inventoryDeviceTags(&row)
			if !inventoryTagsMatch(row.Tags, filters.Tags) {
				continue
			}
			devices = append(devices, row)
			if len(devices) >= filters.Limit {
				break
			}
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			return nil, err
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
		if pageRows < filters.Limit {
			break
		}
	}
	return devices, nil
}

func inventoryPageWhere(filters InventoryFilters, alias string) (string, []any) {
	clauses := []string{"1 = 1"}
	args := []any{}
	queryscope.AddInClause(&clauses, &args, alias+".mac", queryscope.StringsToAny(filters.SourceMACs))
	if filters.Registered != nil {
		clauses = append(clauses, fmt.Sprintf("%s.registered = $%d", alias, len(args)+1))
		args = append(args, *filters.Registered)
	}
	if filters.Query != "" {
		clauses = append(clauses, fmt.Sprintf("(strpos(lower(%s.mac), $%d) > 0 OR strpos(lower(COALESCE(%s.display_name,'')), $%d) > 0)", alias, len(args)+1, alias, len(args)+1))
		args = append(args, strings.ToLower(filters.Query))
	}
	if filters.NeedsIdentityReview {
		pending := "mc.status = 'pending' AND (mc.expires_at IS NULL OR mc.expires_at > CURRENT_TIMESTAMP)"
		clauses = append(clauses, "("+alias+".mac IN (SELECT mc.mac_a FROM atheros_search.merge_candidates mc WHERE "+pending+") OR "+alias+".mac IN (SELECT mc.mac_b FROM atheros_search.merge_candidates mc WHERE "+pending+"))")
	}
	if len(filters.SensorIDs) > 0 || filters.ObservedAfter != nil || filters.ObservedBefore != nil {
		evidence := []string{"sd.status = 'active'", "sd.source_kind = 'event'", "sd.source_mac = " + alias + ".mac"}
		queryscope.AddInClause(&evidence, &args, "sd.location_id", queryscope.StringsToAny(filters.LocationIDs))
		queryscope.AddInClause(&evidence, &args, "sd.sensor_id", queryscope.StringsToAny(filters.SensorIDs))
		if filters.ObservedAfter != nil {
			evidence = append(evidence, fmt.Sprintf("sd.observed_at >= $%d", len(args)+1))
			args = append(args, *filters.ObservedAfter)
		}
		if filters.ObservedBefore != nil {
			evidence = append(evidence, fmt.Sprintf("sd.observed_at < $%d", len(args)+1))
			args = append(args, *filters.ObservedBefore)
		}
		clauses = append(clauses, "EXISTS (SELECT 1 FROM atheros_search.search_documents sd WHERE "+strings.Join(evidence, " AND ")+")")
	}
	queryscope.AddInClause(&clauses, &args, alias+".location_id", queryscope.StringsToAny(filters.LocationIDs))
	queryscope.AddInClause(&clauses, &args, alias+".owner_id", queryscope.StringsToAny(filters.OwnerIDs))
	if filters.ActiveOnly {
		clauses = append(clauses, alias+".active")
	}
	for _, tag := range filters.Tags {
		switch {
		case tag == "device":
		case tag == "registered":
			clauses = append(clauses, alias+".registered")
		case tag == "active":
			clauses = append(clauses, alias+".active")
		case strings.HasPrefix(tag, "owner:"):
			clauses = append(clauses, fmt.Sprintf("lower(COALESCE(%s.owner_id, '')) = $%d", alias, len(args)+1))
			args = append(args, strings.TrimPrefix(tag, "owner:"))
		case strings.HasPrefix(tag, "location:"):
			clauses = append(clauses, fmt.Sprintf("lower(COALESCE(%s.location_id, '')) = $%d", alias, len(args)+1))
			args = append(args, strings.TrimPrefix(tag, "location:"))
		default:
			clauses = append(clauses, fmt.Sprintf("EXISTS (SELECT 1 FROM jsonb_array_elements_text(%s.tags) AS stored_tag(value) WHERE lower(stored_tag.value) = $%d)", alias, len(args)+1))
			args = append(args, tag)
		}
	}
	return strings.Join(clauses, " AND "), args
}

func inventoryPageTotals(ctx context.Context, tx *sql.Tx, filters InventoryFilters, where string, args []any, totalDevices int) (int, int, error) {
	switch filters.Grouping {
	case InventoryGroupingRegistry:
		return totalDevices, 0, nil
	case InventoryGroupingCMDB:
		var owners, locations, ownerEdges, locationEdges int
		err := tx.QueryRowContext(ctx, `
SELECT COUNT(DISTINCT NULLIF(d.owner_id, '')), COUNT(DISTINCT NULLIF(d.location_id, '')),
       COUNT(*) FILTER (WHERE COALESCE(d.owner_id, '') <> ''),
       COUNT(*) FILTER (WHERE COALESCE(d.location_id, '') <> '')
FROM atheros_search.devices d WHERE `+where, args...).Scan(&owners, &locations, &ownerEdges, &locationEdges)
		return totalDevices + owners + locations, ownerEdges + locationEdges, err
	case InventoryGroupingSimilarity:
		whereB, _ := inventoryPageWhere(filters, "db")
		whereA, _ := inventoryPageWhere(filters, "da")
		var candidates int
		err := tx.QueryRowContext(ctx, `
SELECT COUNT(*)
FROM atheros_search.merge_candidates mc
JOIN atheros_search.devices da ON da.mac = mc.mac_a
JOIN atheros_search.devices db ON db.mac = mc.mac_b
WHERE mc.status = 'pending' AND (mc.expires_at IS NULL OR mc.expires_at > CURRENT_TIMESTAMP)
  AND mc.confidence >= $`+fmt.Sprint(len(args)+1)+`
  AND (`+whereA+`) AND (`+whereB+`)`, append(args, minimumInventoryConfidence(filters))...).Scan(&candidates)
		return totalDevices + candidates*2, candidates * 5, err
	default:
		return totalDevices, 0, nil
	}
}
