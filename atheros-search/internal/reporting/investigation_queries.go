package reporting

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/queryscope"
)

func InvestigationScope(request InvestigationRequest, alias string) (string, []any) {
	return investigationScopeWith(request, alias, true)
}

// investigationScopeWith builds the summary-row scope for one alias. Pair
// queries pass deviceAnchor=false so they can express an anchor that appears on
// either side of the pair instead of only on this side.
func investigationScopeWith(request InvestigationRequest, alias string, deviceAnchor bool) (string, []any) {
	clauses := []string{fmt.Sprintf("%s.window_start >= $1", alias), fmt.Sprintf("%s.window_start < $2", alias)}
	args := []any{*request.ObservedAfter, *request.ObservedBefore}
	queryscope.AddInClause(&clauses, &args, alias+".location_id", queryscope.StringsToAny(request.LocationIDs))
	queryscope.AddInClause(&clauses, &args, alias+".sensor_id", queryscope.StringsToAny(request.SensorIDs))
	if request.APBSSID != "" {
		clauses = append(clauses, fmt.Sprintf("%s.bssid=$%d", alias, len(args)+1))
		args = append(args, request.APBSSID)
	}
	if deviceAnchor && request.DeviceMAC != "" {
		clauses = append(clauses, fmt.Sprintf("%s.source_mac=$%d", alias, len(args)+1))
		args = append(args, request.DeviceMAC)
	}
	return strings.Join(clauses, " AND "), args
}

func InvestigationWatermarks(ctx context.Context, tx *sql.Tx) (InvestigationFreshness, error) {
	result := InvestigationFreshness{CoverageStatus: "unknown"}
	var source, projection sql.NullTime
	var reason sql.NullString
	err := tx.QueryRowContext(ctx, `SELECT source_watermark_at, projection_watermark_at, coverage_status, coverage_reason
FROM atheros_search.investigation_watermarks WHERE projection_name='wireless_evidence'`).Scan(&source, &projection, &result.CoverageStatus, &reason)
	if errors.Is(err, sql.ErrNoRows) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	result.SourceWatermark = queryscope.NullTimePtr(source)
	result.ProjectionWatermark = queryscope.NullTimePtr(projection)
	result.CoverageReason = reason.String
	return result, nil
}

// nodeIdentifiers splits the bounded node set into the device MACs and AP
// BSSIDs that follow-up link queries may reference. Link queries never grow the
// node set, so the 200-node budget stays authoritative.
func nodeIdentifiers(nodes []GraphNode) (devices []string, aps []string) {
	for _, node := range nodes {
		switch node.Kind {
		case "device":
			if node.MAC != "" {
				devices = append(devices, node.MAC)
			}
		case "ap":
			if node.BSSID != "" {
				aps = append(aps, node.BSSID)
			}
		}
	}
	return devices, aps
}
