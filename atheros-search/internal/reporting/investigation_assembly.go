package reporting

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/queryscope"
)

func (s *Service) Investigation(ctx context.Context, request InvestigationRequest) (*InvestigationResponse, error) {
	request, err := NormalizeInvestigationRequest(request)
	if err != nil {
		return nil, err
	}
	tx, err := s.Pool.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }() // Cleanup after the operation; Commit errors are returned and an already committed transaction needs no rollback.
	freshness, err := InvestigationWatermarks(ctx, tx)
	if err != nil {
		return nil, err
	}
	scope, args := InvestigationScope(request, "summary")
	response := &InvestigationResponse{Anchor: request.Anchor, Nodes: []GraphNode{}, Links: []InvestigationLink{}, Roster: []RosterMember{}, Evidence: []InvestigationEvidence{}, EvidencePage: request.EvidencePage, EvidencePageSize: request.EvidenceSize, RFProximity: "unknown", Freshness: freshness, GeneratedAt: time.Now().UTC()}
	freshCutoff := response.GeneratedAt.Add(-24 * time.Hour)

	if err := s.investigationRoster(ctx, tx, scope, args, request, response, freshCutoff); err != nil {
		return nil, err
	}
	if err := s.investigationEvidence(ctx, tx, scope, args, request, response); err != nil {
		return nil, err
	}
	if err := s.investigationAssociationLinks(ctx, tx, request, response, freshCutoff); err != nil {
		return nil, err
	}
	if err := s.investigationTypedLinks(ctx, tx, request, response, freshCutoff); err != nil {
		return nil, err
	}
	if err := s.investigationRFSimilarityLinks(ctx, tx, request, response, freshCutoff); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	if response.EvidenceTotal == 0 {
		response.FocusReason = "No retained evidence matches this scope. A partial or stalled projection does not establish that no devices were observed."
	}
	if freshness.CoverageStatus != "complete" {
		response.FocusReason = strings.TrimSpace(response.FocusReason + " Evidence coverage is " + freshness.CoverageStatus + ": " + freshness.CoverageReason)
	}
	if response.rfProximityReason != "" {
		response.FocusReason = strings.TrimSpace(response.FocusReason + " " + response.rfProximityReason)
	}
	response.SignalQuality = "RSSI unavailable"
	for _, evidence := range response.Evidence {
		if evidence.RSSISampleCount > 0 {
			response.SignalQuality = "sensor-measured RSSI available"
			break
		}
	}
	response.Confidence = "evidence quality is based on retained frame and sensor coverage; it is not a probability or physical distance"
	return response, nil
}

func (s *Service) investigationRoster(ctx context.Context, tx *sql.Tx, scope string, args []any, request InvestigationRequest, response *InvestigationResponse, freshCutoff time.Time) error {
	queryArgs := append([]any{}, args...)
	queryArgs = append(queryArgs, request.NodeLimit)
	// #nosec G202 -- Fixed SQL clauses and allowlisted ordering; request values are bound as parameters.
	rows, err := tx.QueryContext(ctx, `SELECT summary.bssid, summary.source_mac, SUM(summary.frame_count), MIN(summary.first_observed_at), MAX(summary.last_observed_at), COUNT(DISTINCT summary.sensor_id),
COALESCE(annotation.label, NULLIF(device.display_name,''), summary.source_mac), COALESCE(annotation.pinned,FALSE)
FROM atheros_search.wireless_signal_summaries summary
LEFT JOIN atheros_search.devices device ON device.mac=summary.source_mac
LEFT JOIN atheros_search.asset_annotations annotation ON annotation.asset_kind='device' AND annotation.asset_id=summary.source_mac
WHERE `+scope+` GROUP BY summary.bssid,summary.source_mac,annotation.label,device.display_name,annotation.pinned
ORDER BY COALESCE(annotation.pinned,FALSE) DESC,MAX(summary.last_observed_at) DESC,summary.bssid,summary.source_mac LIMIT $`+fmt.Sprint(len(queryArgs)), queryArgs...)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }() // Release resources on early return; query, scan, and iteration errors are checked separately.
	nodes := map[string]GraphNode{}
	for rows.Next() {
		var bssid, mac, label string
		var count, sensors int
		var first, last time.Time
		var pinned bool
		if err := rows.Scan(&bssid, &mac, &count, &first, &last, &sensors, &label, &pinned); err != nil {
			return err
		}
		apID := "ap:" + bssid
		if _, ok := nodes[apID]; !ok {
			nodes[apID] = GraphNode{ID: apID, Kind: "ap", Label: bssid, BSSID: bssid, ObservedAt: &last}
		}
		deviceID := "device:" + mac
		nodes[deviceID] = GraphNode{ID: deviceID, Kind: "device", Label: label, MAC: mac, FirstSeen: &first, LastSeen: &last}
		response.Roster = append(response.Roster, RosterMember{MAC: mac, Name: label, FirstObserved: first, LastObserved: last, RecordCount: count})
		response.Links = append(response.Links, InvestigationLink{ID: "observed:" + mac + ":" + bssid, Source: deviceID, Target: apID, Type: "observed_ap_context", Weight: float64(count), WeightBasis: "frame_count", Confidence: confidenceFor(count, sensors), Fresh: !last.Before(freshCutoff)})
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, node := range nodes {
		response.Nodes = append(response.Nodes, node)
	}
	sort.Slice(response.Nodes, func(i, j int) bool { return response.Nodes[i].ID < response.Nodes[j].ID })
	return nil
}

func confidenceFor(frames, sensors int) string {
	if frames >= 10 && sensors >= 2 {
		return "repeated multi-sensor evidence"
	}
	if frames >= 3 {
		return "repeated evidence"
	}
	return "limited observed evidence"
}

func (s *Service) investigationEvidence(ctx context.Context, tx *sql.Tx, scope string, args []any, request InvestigationRequest, response *InvestigationResponse) error {
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM atheros_search.wireless_signal_summaries summary WHERE "+scope, args...).Scan(&response.EvidenceTotal); err != nil {
		return err
	}
	queryArgs := append([]any{}, args...)
	queryArgs = append(queryArgs, request.EvidenceSize, request.EvidencePage*request.EvidenceSize)
	// #nosec G202 -- Fixed SQL clauses and allowlisted ordering; request values are bound as parameters.
	rows, err := tx.QueryContext(ctx, `SELECT window_start,sensor_id,COALESCE(location_id,''),bssid,source_mac,frame_count,rssi_sample_count,rssi_min_dbm,rssi_max_dbm,rssi_avg_dbm,first_observed_at,last_observed_at
FROM atheros_search.wireless_signal_summaries summary WHERE `+scope+` ORDER BY window_start DESC,sensor_id,bssid,source_mac LIMIT $`+fmt.Sprint(len(queryArgs)-1)+" OFFSET $"+fmt.Sprint(len(queryArgs)), queryArgs...)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }() // Release resources on early return; query, scan, and iteration errors are checked separately.
	for rows.Next() {
		var item InvestigationEvidence
		var min, max sql.NullInt64
		var avg sql.NullFloat64
		if err := rows.Scan(&item.WindowStart, &item.SensorID, &item.LocationID, &item.BSSID, &item.DeviceMAC, &item.FrameCount, &item.RSSISampleCount, &min, &max, &avg, &item.FirstObservedAt, &item.LastObservedAt); err != nil {
			return err
		}
		if min.Valid {
			v := int(min.Int64)
			item.RSSIMinDBM = &v
		}
		if max.Valid {
			v := int(max.Int64)
			item.RSSIMaxDBM = &v
		}
		if avg.Valid {
			v := avg.Float64
			item.RSSIAvgDBM = &v
		}
		item.Reference = fmt.Sprintf("signal-summary:%s:%s:%s:%s", item.WindowStart.UTC().Format(time.RFC3339), item.SensorID, item.BSSID, item.DeviceMAC)
		response.Evidence = append(response.Evidence, item)
	}
	return rows.Err()
}

func (s *Service) investigationTypedLinks(ctx context.Context, tx *sql.Tx, request InvestigationRequest, response *InvestigationResponse, freshCutoff time.Time) error {
	remaining := request.EdgeLimit - len(response.Links)
	if remaining <= 0 || len(response.Nodes) == 0 {
		return nil
	}
	ids := make([]any, 0, len(response.Nodes))
	known := map[string]bool{}
	for _, node := range response.Nodes {
		ids = append(ids, node.ID)
		known[node.ID] = true
	}
	// Confirmed identity is sourced only from the coordinator's guarded graph projection.
	// #nosec G202 -- Fixed SQL clauses and allowlisted ordering; request values are bound as parameters.
	rows, err := tx.QueryContext(ctx, `SELECT edge_id,source_node_id,target_node_id,observed_at FROM atheros_search.graph_edges
WHERE edge_kind='same_device' AND observed_at >= $1 AND source_node_id IN (`+queryscope.PgPlaceholders(2, len(ids))+") AND target_node_id IN ("+queryscope.PgPlaceholders(2+len(ids), len(ids))+") ORDER BY observed_at DESC,edge_id LIMIT $"+fmt.Sprint(2+len(ids)*2), append(append([]any{*request.ObservedAfter}, ids...), append(ids, remaining)...)...)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }() // Release resources on early return; query, scan, and iteration errors are checked separately.
	for rows.Next() {
		var id, source, target string
		var observedAt time.Time
		if err := rows.Scan(&id, &source, &target, &observedAt); err != nil {
			return err
		}
		if known[source] && known[target] && len(response.Links) < request.EdgeLimit {
			response.Links = append(response.Links, InvestigationLink{ID: id, Source: source, Target: target, Type: "confirmed_identity", WeightBasis: "operator_confirmation", Confidence: "operator-confirmed identity", Fresh: !observedAt.Before(freshCutoff)})
		}
	}
	return rows.Err()
}

// Association frames are direct frame evidence that a station joined, rejoined
// or left a specific AP. They are a separate link type from observed context
// because observing a probe or data frame at an AP does not evidence a session.
func (s *Service) investigationAssociationLinks(ctx context.Context, tx *sql.Tx, request InvestigationRequest, response *InvestigationResponse, freshCutoff time.Time) error {
	remaining := request.EdgeLimit - len(response.Links)
	if remaining <= 0 {
		return nil
	}
	devices, aps := nodeIdentifiers(response.Nodes)
	if len(devices) == 0 || len(aps) == 0 {
		return nil
	}
	args := []any{*request.ObservedAfter, *request.ObservedBefore}
	clauses := []string{"d.source_kind='event'", "d.status='active'",
		"d.observed_at >= $1", "d.observed_at < $2",
		"(d.frame_subtype IN (" + associationFrameSubtypes + ") OR d.handshake_captured)"}
	queryscope.AddInClause(&clauses, &args, "d.location_id", queryscope.StringsToAny(request.LocationIDs))
	queryscope.AddInClause(&clauses, &args, "d.sensor_id", queryscope.StringsToAny(request.SensorIDs))
	queryscope.AddInClause(&clauses, &args, "d.source_mac", queryscope.StringsToAny(devices))
	queryscope.AddInClause(&clauses, &args, "d.bssid", queryscope.StringsToAny(aps))
	args = append(args, remaining)
	// #nosec G202 -- Fixed SQL clauses and allowlisted ordering; request values are bound as parameters.
	rows, err := tx.QueryContext(ctx, `SELECT d.source_mac, d.bssid, COUNT(*) AS frame_count,
       MAX(d.observed_at) AS last_seen, BOOL_OR(d.handshake_captured) AS handshake
FROM atheros_search.search_documents d
WHERE `+strings.Join(clauses, " AND ")+`
GROUP BY d.source_mac, d.bssid
ORDER BY MAX(d.observed_at) DESC, d.source_mac, d.bssid
LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }() // Release resources on early return; query, scan, and iteration errors are checked separately.
	seen := map[string]bool{}
	for _, link := range response.Links {
		seen[link.ID] = true
	}
	for rows.Next() {
		var mac, bssid string
		var frames int
		var lastSeen time.Time
		var handshake bool
		if err := rows.Scan(&mac, &bssid, &frames, &lastSeen, &handshake); err != nil {
			return err
		}
		id := "assoc:" + mac + ":" + bssid
		if seen[id] || len(response.Links) >= request.EdgeLimit {
			continue
		}
		seen[id] = true
		response.Links = append(response.Links, InvestigationLink{
			ID:          "assoc:" + mac + ":" + bssid,
			Source:      "device:" + mac,
			Target:      "ap:" + bssid,
			Type:        "association_frame_evidence",
			Weight:      float64(frames),
			WeightBasis: "frame_count",
			Evidence: []string{fmt.Sprintf("association-frame:%s:%s:%s",
				mac, bssid, lastSeen.UTC().Format(time.RFC3339))},
			Confidence: associationConfidence(frames, handshake),
			Fresh:      !lastSeen.Before(freshCutoff),
		})
	}
	return rows.Err()
}

// Confidence describes evidence quality only. It is never a probability, a
// distance estimate, or a claim that the station completed a session.
func associationConfidence(frames int, handshake bool) string {
	switch {
	case handshake:
		return "captured handshake with association frames"
	case frames >= 3:
		return "repeated association frames"
	default:
		return "single association frame"
	}
}

// RF similarity links devices that repeatedly share the same five-minute
// sensor window on the same AP. The gate needs two or more distinct sensors and
// two or more distinct windows: one sensor can only report proximity it cannot
// corroborate, so proximity stays unknown below that floor. The CTE is named
// rf_sensor_windows because OVERLAPS is a reserved word in PostgreSQL and cannot
// be used as a relation name.
func (s *Service) investigationRFSimilarityLinks(ctx context.Context, tx *sql.Tx, request InvestigationRequest, response *InvestigationResponse, freshCutoff time.Time) error {
	devices, _ := nodeIdentifiers(response.Nodes)
	remaining := request.EdgeLimit - len(response.Links)
	if len(devices) < 2 || remaining <= 0 {
		return nil
	}
	scope, args := investigationScopeWith(request, "a", false)
	clauses := []string{scope}
	queryscope.AddInClause(&clauses, &args, "a.source_mac", queryscope.StringsToAny(devices))
	queryscope.AddInClause(&clauses, &args, "b.source_mac", queryscope.StringsToAny(devices))
	if request.DeviceMAC != "" {
		clauses = append(clauses, fmt.Sprintf("(a.source_mac=$%d OR b.source_mac=$%d)", len(args)+1, len(args)+2))
		args = append(args, request.DeviceMAC, request.DeviceMAC)
	}
	clauses = append(clauses, "b.source_mac > a.source_mac")
	args = append(args, remaining)
	// #nosec G202 -- Fixed SQL clauses and allowlisted ordering; request values are bound as parameters.
	rows, err := tx.QueryContext(ctx, `WITH rf_sensor_windows AS (
  SELECT a.source_mac AS left_mac, b.source_mac AS right_mac,
         a.window_start, a.sensor_id, a.bssid, a.last_observed_at,
         row_number() OVER (PARTITION BY a.source_mac, b.source_mac
                            ORDER BY a.window_start DESC) AS rn
  FROM atheros_search.wireless_signal_summaries a
  JOIN atheros_search.wireless_signal_summaries b
    ON b.window_start = a.window_start
   AND b.sensor_id = a.sensor_id
   AND b.bssid = a.bssid
   AND b.source_mac > a.source_mac
  WHERE `+strings.Join(clauses, " AND ")+`
)
SELECT left_mac, right_mac,
       COUNT(DISTINCT window_start) AS window_count,
       COUNT(DISTINCT sensor_id) AS sensor_count,
       MAX(last_observed_at) AS last_seen,
       COALESCE(string_agg('signal-summary:' ||
         to_char(window_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') || ':' ||
         sensor_id || ':' || bssid || ':' || left_mac,
         '|' ORDER BY rn) FILTER (WHERE rn <= 3), '') AS evidence_refs
FROM rf_sensor_windows
GROUP BY left_mac, right_mac
ORDER BY sensor_count DESC, window_count DESC, left_mac, right_mac
LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }() // Release resources on early return; query, scan, and iteration errors are checked separately.
	var best [2]int
	evaluated := false
	for rows.Next() {
		var left, right, refs string
		var lastSeen time.Time
		var overlap rfOverlap
		if err := rows.Scan(&left, &right, &overlap.windows, &overlap.sensors, &lastSeen, &refs); err != nil {
			return err
		}
		evaluated = true
		if overlap.sensors > best[0] || (overlap.sensors == best[0] && overlap.windows > best[1]) {
			best = [2]int{overlap.sensors, overlap.windows}
		}
		if !QualifiesRFOverlap(overlap.sensors, overlap.windows) || len(response.Links) >= request.EdgeLimit {
			continue
		}
		response.RFProximity = "inferred"
		response.Links = append(response.Links, InvestigationLink{
			ID:          "rf-sim:" + left + ":" + right,
			Source:      "device:" + left,
			Target:      "device:" + right,
			Type:        "inferred_rf_similarity",
			Weight:      float64(overlap.windows),
			WeightBasis: "time_overlap_windows",
			Evidence:    splitEvidenceRefs(refs),
			Confidence:  RFConfidence(overlap.sensors, overlap.windows),
			Fresh:       !lastSeen.Before(freshCutoff),
		})
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if evaluated && response.RFProximity != "inferred" {
		if best[0] == 0 {
			response.rfProximityReason = "RF proximity is unknown: no two devices share a retained sensor window in this scope."
		} else {
			response.rfProximityReason = fmt.Sprintf(
				"RF proximity is unknown: the best observed overlap was %d window(s) across %d sensor(s), and two sensors with repeated overlap are required.",
				best[1], best[0])
		}
	}
	return nil
}

func splitEvidenceRefs(raw string) []string {
	if raw == "" {
		return nil
	}
	return strings.Split(raw, "|")
}

func QualifiesRFOverlap(sensors, windows int) bool {
	return sensors >= 2 && windows >= 2
}

func RFConfidence(sensors, windows int) string {
	return fmt.Sprintf("inferred from %d window(s) of overlap across %d sensors; a proximity hint, not a measured distance", windows, sensors)
}

// Evidence is intentionally the same bounded page returned by Investigation.
// Keeping a dedicated endpoint makes detail panels independent from graph reloads.
func (s *Service) Evidence(ctx context.Context, request InvestigationRequest) (*InvestigationResponse, error) {
	return s.Investigation(ctx, request)
}
