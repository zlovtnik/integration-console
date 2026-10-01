package reporting

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/apperror"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/queryscope"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/reportmeta"
)

type NetworkFilters struct {
	LocationIDs    []string   `json:"location_ids,omitempty"`
	SensorIDs      []string   `json:"sensor_ids,omitempty"`
	ObservedAfter  *time.Time `json:"observed_after,omitempty"`
	ObservedBefore *time.Time `json:"observed_before,omitempty"`
	SourceMAC      string     `json:"source_mac,omitempty"`
	SourceMACs     []string   `json:"source_macs,omitempty"`
	SSID           string     `json:"ssid,omitempty"`
	Query          string     `json:"query,omitempty"`
	APBSSID        string     `json:"ap_bssid,omitempty"`
	PageSize       int        `json:"page_size,omitempty"`
	PageCursor     string     `json:"page_cursor,omitempty"`
	IncludeHints   bool       `json:"include_hints,omitempty"`
}

type AccessPointOverview struct {
	BSSID           string    `json:"bssid"`
	Name            string    `json:"name"`
	IdentifierCount int       `json:"identifier_count"`
	FirstObserved   time.Time `json:"first_observed"`
	LastObserved    time.Time `json:"last_observed"`
	EvidenceStatus  string    `json:"evidence_status"`
}

type RosterMember struct {
	MAC           string    `json:"mac"`
	Name          string    `json:"name"`
	FirstObserved time.Time `json:"first_observed"`
	LastObserved  time.Time `json:"last_observed"`
	RecordCount   int       `json:"record_count"`
}

type NetworkResponse struct {
	AccessPoints   []AccessPointOverview `json:"access_points"`
	Roster         []RosterMember        `json:"roster"`
	Nodes          []GraphNode           `json:"nodes"`
	Edges          []GraphEdge           `json:"edges"`
	GeneratedAt    time.Time             `json:"generated_at"`
	NextPageCursor string                `json:"next_page_cursor,omitempty"`
	TotalRows      int                   `json:"total_rows"`
	FocusReason    string                `json:"focus_reason,omitempty"`
	Report         *reportmeta.Metadata  `json:"report"`
}

func networkEvidence(filters NetworkFilters) (string, []any) {
	clauses := []string{"d.source_kind = 'event'", "d.status = 'active'", queryscope.QualifyingAPSQL("d")}
	args := []any{}
	queryscope.AddInClause(&clauses, &args, "d.location_id", queryscope.StringsToAny(filters.LocationIDs))
	queryscope.AddInClause(&clauses, &args, "d.sensor_id", queryscope.StringsToAny(filters.SensorIDs))
	macs := queryscope.NormalizeLowerList(append(append([]string(nil), filters.SourceMACs...), filters.SourceMAC))
	queryscope.AddInClause(&clauses, &args, "d.source_mac", queryscope.StringsToAny(macs))
	for _, item := range []struct{ column, value string }{{"bssid", filters.APBSSID}} {
		if item.value != "" {
			clauses = append(clauses, fmt.Sprintf("d.%s = $%d", item.column, len(args)+1))
			args = append(args, item.value)
		}
	}
	if filters.ObservedAfter != nil {
		clauses = append(clauses, fmt.Sprintf("d.observed_at >= $%d", len(args)+1))
		args = append(args, *filters.ObservedAfter)
	}
	if filters.ObservedBefore != nil {
		clauses = append(clauses, fmt.Sprintf("d.observed_at < $%d", len(args)+1))
		args = append(args, *filters.ObservedBefore)
	}
	if filters.Query != "" {
		clauses = append(clauses, queryscope.EntityScopeSQL("d", fmt.Sprintf("$%d", len(args)+1)))
		args = append(args, strings.ToLower(filters.Query))
	}
	if filters.SSID != "" {
		clauses = append(clauses, fmt.Sprintf("strpos(lower(COALESCE(d.ssid,'')),$%d)>0", len(args)+1))
		args = append(args, strings.ToLower(filters.SSID))
	}
	return "WITH evidence AS (SELECT d.document_id, d.source_mac, d.bssid, d.ssid, d.observed_at FROM atheros_search.search_documents d WHERE " + strings.Join(clauses, " AND ") + `) `, args
}

func (s *Service) Network(ctx context.Context, filters NetworkFilters) (*NetworkResponse, error) {
	filters.LocationIDs = queryscope.NormalizeGraphList(filters.LocationIDs)
	filters.SensorIDs = queryscope.NormalizeGraphList(filters.SensorIDs)
	filters.APBSSID = strings.ToLower(strings.TrimSpace(filters.APBSSID))
	filters.SourceMAC = strings.ToLower(strings.TrimSpace(filters.SourceMAC))
	filters.SourceMACs = queryscope.NormalizeLowerList(filters.SourceMACs)
	filters.SSID = strings.TrimSpace(filters.SSID)
	filters.Query = strings.TrimSpace(filters.Query)
	if filters.APBSSID != "" && !queryscope.MacPattern.MatchString(filters.APBSSID) {
		return nil, apperror.Validationf("unsupported graph kind: invalid AP BSSID")
	}
	if filters.ObservedAfter != nil && filters.ObservedBefore != nil && !filters.ObservedAfter.Before(*filters.ObservedBefore) {
		return nil, apperror.Validationf("observed_after must be before observed_before")
	}
	if filters.PageSize <= 0 {
		filters.PageSize = 50
	}
	if filters.PageSize > 199 {
		filters.PageSize = 199
	}
	identity := filters
	identity.PageCursor = ""
	identity.PageSize = 0
	fingerprint, err := pageFingerprint(identity)
	if err != nil {
		return nil, err
	}
	cursor, err := decodePageCursor(filters.PageCursor, "network", fingerprint)
	if err != nil {
		return nil, err
	}
	tx, err := s.Pool.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }() // Cleanup after the operation; Commit errors are returned and an already committed transaction needs no rollback.
	cte, args := networkEvidence(filters)
	response := &NetworkResponse{AccessPoints: []AccessPointOverview{}, Roster: []RosterMember{}, Nodes: []GraphNode{}, Edges: []GraphEdge{}, GeneratedAt: time.Now().UTC()}
	grain := "access point BSSID"
	meaning := "APs with qualifying searchable wireless records; per-AP counts are distinct MACs"
	countSQL := `SELECT COUNT(DISTINCT bssid), MIN(observed_at), MAX(observed_at) FROM evidence`
	if filters.APBSSID != "" {
		grain = "observed MAC identifier"
		meaning = "distinct qualifying source MACs for the selected AP"
		countSQL = `SELECT COUNT(DISTINCT source_mac), MIN(observed_at), MAX(observed_at) FROM evidence`
	}
	var first, last sql.NullTime
	if err := tx.QueryRowContext(ctx, cte+countSQL, args...).Scan(&response.TotalRows, &first, &last); err != nil {
		return nil, err
	}
	if filters.APBSSID == "" {
		pageArgs := append([]any(nil), args...)
		having := ""
		if cursor.NodeAfter != "" {
			having = fmt.Sprintf(" HAVING COUNT(DISTINCT source_mac) < $%d OR (COUNT(DISTINCT source_mac) = $%d AND bssid > $%d)", len(pageArgs)+1, len(pageArgs)+1, len(pageArgs)+2)
			pageArgs = append(pageArgs, cursor.CountAfter, cursor.NodeAfter)
		}
		pageArgs = append(pageArgs, filters.PageSize+1)
		rows, err := tx.QueryContext(ctx, cte+`SELECT bssid, COALESCE(MAX(NULLIF(ssid,'')),''), COUNT(DISTINCT source_mac),MIN(observed_at),MAX(observed_at)
 FROM evidence GROUP BY bssid`+having+` ORDER BY COUNT(DISTINCT source_mac) DESC,bssid ASC LIMIT $`+fmt.Sprint(len(pageArgs)), pageArgs...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var ap AccessPointOverview
			if err := rows.Scan(&ap.BSSID, &ap.Name, &ap.IdentifierCount, &ap.FirstObserved, &ap.LastObserved); err != nil {
				_ = rows.Close() // Preserve the primary scan/iteration error; Close is checked on the successful path.
				return nil, err
			}
			ap.EvidenceStatus = "searchable evidence; freshness and capture coverage unverified"
			response.AccessPoints = append(response.AccessPoints, ap)
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close() // Preserve the primary scan/iteration error; Close is checked on the successful path.
			return nil, err
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
		if len(response.AccessPoints) > filters.PageSize {
			response.AccessPoints = response.AccessPoints[:filters.PageSize]
			end := response.AccessPoints[len(response.AccessPoints)-1]
			cursor.NodeAfter = end.BSSID
			cursor.CountAfter = end.IdentifierCount
			response.NextPageCursor, err = encodePageCursor(cursor)
			if err != nil {
				return nil, err
			}
		}
	} else {
		if response.TotalRows == 0 {
			response.FocusReason = "No qualifying AP evidence in the selected searchable scope. Capture coverage is unverified."
		}
		pageArgs := append([]any(nil), args...)
		where := ""
		if cursor.DeviceAfter != "" {
			where = fmt.Sprintf(" WHERE e.source_mac > $%d", len(pageArgs)+1)
			pageArgs = append(pageArgs, cursor.DeviceAfter)
		}
		pageArgs = append(pageArgs, filters.PageSize+1)
		rows, err := tx.QueryContext(ctx, cte+`SELECT e.source_mac, COALESCE(MAX(reg.display_name),''),MIN(e.observed_at),MAX(e.observed_at),COUNT(DISTINCT e.document_id)
 FROM evidence e LEFT JOIN atheros_search.devices reg ON reg.mac=e.source_mac`+where+` GROUP BY e.source_mac ORDER BY e.source_mac LIMIT $`+fmt.Sprint(len(pageArgs)), pageArgs...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var member RosterMember
			if err := rows.Scan(&member.MAC, &member.Name, &member.FirstObserved, &member.LastObserved, &member.RecordCount); err != nil {
				_ = rows.Close() // Preserve the primary scan/iteration error; Close is checked on the successful path.
				return nil, err
			}
			response.Roster = append(response.Roster, member)
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close() // Preserve the primary scan/iteration error; Close is checked on the successful path.
			return nil, err
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
		if len(response.Roster) > filters.PageSize {
			response.Roster = response.Roster[:filters.PageSize]
			cursor.DeviceAfter = response.Roster[len(response.Roster)-1].MAC
			response.NextPageCursor, err = encodePageCursor(cursor)
			if err != nil {
				return nil, err
			}
		}
		if response.TotalRows > 0 {
			apID := "ap:" + filters.APBSSID
			response.Nodes = append(response.Nodes, GraphNode{ID: apID, Kind: "ap", Label: filters.APBSSID, BSSID: filters.APBSSID, ObservedAt: queryscope.NullTimePtr(last)})
			for _, member := range response.Roster {
				label := member.Name
				if label == "" {
					label = member.MAC
				}
				nodeID := "device:" + member.MAC
				response.Nodes = append(response.Nodes, GraphNode{ID: nodeID, Kind: "device", Label: label, MAC: member.MAC, FirstSeen: &member.FirstObserved, LastSeen: &member.LastObserved})
				weight := float64(member.RecordCount)
				response.Edges = append(response.Edges, GraphEdge{ID: "observed:" + member.MAC + ":" + filters.APBSSID, Source: nodeID, Target: apID, Kind: "association", Weight: &weight, WeightBasis: "searchable_record_count", Label: "Observed AP context"})
			}
			if filters.IncludeHints {
				hints, err := fetchGraphEdges(ctx, tx, GraphFilters{Limit: 200, EdgeKinds: []string{"cluster_member", "rf_proximity", "roaming", "same_channel", "vendor_link"}}, response.Nodes)
				if err != nil {
					return nil, err
				}
				keep := map[string]bool{}
				for _, node := range response.Nodes {
					keep[node.ID] = true
				}
				clusterIDs := []any{}
				requested := map[string]bool{}
				for _, edge := range hints {
					if edge.Kind == "cluster_member" && !keep[edge.Target] && !requested[edge.Target] {
						clusterIDs = append(clusterIDs, edge.Target)
						requested[edge.Target] = true
					}
				}
				budget := 200 - len(response.Nodes)
				if len(clusterIDs) > 0 && budget > 0 {
					queryArgs := append(clusterIDs, budget)
					// #nosec G202 -- Only numbered placeholders are concatenated; cluster IDs are bound as parameters.
					rows, err := tx.QueryContext(ctx, `SELECT node_id,node_kind,label,COALESCE(node_payload::text,'{}'),location_id,sensor_id,normalized_mac,normalized_ssid,is_threat,observed_at
					FROM atheros_search.graph_nodes WHERE node_kind='identity_cluster' AND node_id IN (`+queryscope.PgPlaceholders(1, len(clusterIDs))+`) ORDER BY node_id LIMIT $`+fmt.Sprint(len(queryArgs)), queryArgs...)
					if err != nil {
						return nil, err
					}
					for rows.Next() {
						var row graphNodeRow
						if err := rows.Scan(&row.NodeID, &row.NodeKind, &row.Label, &row.NodePayload, &row.LocationID, &row.SensorID, &row.NormalizedMAC, &row.NormalizedSSID, &row.IsThreat, &row.ObservedAt); err != nil {
							_ = rows.Close() // Preserve the primary scan/iteration error; Close is checked on the successful path.
							return nil, err
						}
						response.Nodes = append(response.Nodes, graphNodeFromRow(row))
						keep[row.NodeID] = true
					}
					if err := rows.Err(); err != nil {
						_ = rows.Close() // Preserve the primary scan/iteration error; Close is checked on the successful path.
						return nil, err
					}
					if err := rows.Close(); err != nil {
						return nil, err
					}
				}
				for _, edge := range hints {
					if keep[edge.Source] && keep[edge.Target] {
						response.Edges = append(response.Edges, edge)
					}
				}
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	loaded := len(response.AccessPoints)
	if filters.APBSSID != "" {
		loaded = len(response.Roster)
	}
	response.Report = reportmeta.New(identity, grain, meaning, "retained active searchable wireless records; unknown roles included, self/broadcast/unspecified addresses excluded; multi-AP identifiers count at each AP", loaded, &response.TotalRows)
	response.Report.ObservationStart = queryscope.NullTimePtr(first)
	response.Report.ObservationEnd = queryscope.NullTimePtr(last)
	return response, nil
}
