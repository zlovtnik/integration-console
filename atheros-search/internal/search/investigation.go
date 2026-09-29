package search

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	InvestigationDefaultNodes = 200
	InvestigationDefaultEdges = 400
	InvestigationDefaultRows  = 50

	// Frame subtypes that are only exchanged with an AP a station is joining,
	// leaving or has joined. Probe and beacon frames are deliberately absent:
	// they observe an AP without evidencing association.
	associationFrameSubtypes = "'association_request','association_response'," +
		"'reassociation_request','reassociation_response'," +
		"'authentication','disassociation','deauthentication'"
)

type InvestigationAnchor struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

type InvestigationRequest struct {
	Anchor         InvestigationAnchor `json:"anchor"`
	APBSSID        string              `json:"ap_bssid,omitempty"`
	DeviceMAC      string              `json:"device_mac,omitempty"`
	LocationIDs    []string            `json:"location_ids,omitempty"`
	SensorIDs      []string            `json:"sensor_ids,omitempty"`
	SSID           string              `json:"ssid,omitempty"` // Kept for shared URL scope; summaries intentionally do not persist raw SSIDs.
	ObservedAfter  *time.Time          `json:"observed_after,omitempty"`
	ObservedBefore *time.Time          `json:"observed_before,omitempty"`
	NodeLimit      int                 `json:"node_limit,omitempty"`
	EdgeLimit      int                 `json:"edge_limit,omitempty"`
	EvidencePage   int                 `json:"evidence_page,omitempty"`
	EvidenceSize   int                 `json:"evidence_page_size,omitempty"`
}

type InvestigationEvidence struct {
	Reference       string    `json:"reference"`
	WindowStart     time.Time `json:"window_start"`
	SensorID        string    `json:"sensor_id"`
	LocationID      string    `json:"location_id,omitempty"`
	BSSID           string    `json:"bssid"`
	DeviceMAC       string    `json:"device_mac"`
	FrameCount      int       `json:"frame_count"`
	RSSIAvgDBM      *float64  `json:"rssi_avg_dbm,omitempty"`
	RSSIMinDBM      *int      `json:"rssi_min_dbm,omitempty"`
	RSSIMaxDBM      *int      `json:"rssi_max_dbm,omitempty"`
	RSSISampleCount int       `json:"rssi_sample_count"`
	FirstObservedAt time.Time `json:"first_observed_at"`
	LastObservedAt  time.Time `json:"last_observed_at"`
}

type InvestigationResponse struct {
	Anchor           InvestigationAnchor     `json:"anchor"`
	Nodes            []GraphNode             `json:"nodes"`
	Links            []InvestigationLink     `json:"links"`
	Roster           []RosterMember          `json:"roster"`
	Evidence         []InvestigationEvidence `json:"evidence"`
	EvidencePage     int                     `json:"evidence_page"`
	EvidencePageSize int                     `json:"evidence_page_size"`
	EvidenceTotal    int                     `json:"evidence_total"`
	SignalQuality    string                  `json:"signal_quality"`
	Confidence       string                  `json:"confidence"`
	RFProximity      string                  `json:"rf_proximity"`
	Freshness        InvestigationFreshness  `json:"freshness"`
	FocusReason      string                  `json:"focus_reason,omitempty"`
	GeneratedAt      time.Time               `json:"generated_at"`

	rfProximityReason string
}

type InvestigationLink struct {
	ID string `json:"id"`
	// Weight is the numeric strength of the link in whatever unit WeightBasis
	// names, never a probability. Links that carry no numeric evidence leave
	// both empty rather than implying a score.
	Weight      float64  `json:"weight,omitempty"`
	WeightBasis string   `json:"weight_basis,omitempty"`
	Source      string   `json:"source"`
	Target      string   `json:"target"`
	Type        string   `json:"type"`
	Evidence    []string `json:"evidence_references,omitempty"`
	Confidence  string   `json:"confidence"`
	Fresh       bool     `json:"fresh"`
}

type InvestigationFreshness struct {
	SourceWatermark     *time.Time `json:"source_watermark,omitempty"`
	ProjectionWatermark *time.Time `json:"projection_watermark,omitempty"`
	CoverageStatus      string     `json:"coverage_status"`
	CoverageReason      string     `json:"coverage_reason,omitempty"`
}

func normalizeInvestigationRequest(request InvestigationRequest) (InvestigationRequest, error) {
	request.Anchor.Kind = strings.ToLower(strings.TrimSpace(request.Anchor.Kind))
	request.Anchor.ID = strings.ToLower(strings.TrimSpace(request.Anchor.ID))
	request.APBSSID = strings.ToLower(strings.TrimSpace(request.APBSSID))
	request.DeviceMAC = strings.ToLower(strings.TrimSpace(request.DeviceMAC))
	if request.Anchor.Kind != "" {
		if request.Anchor.Kind != "ap" && request.Anchor.Kind != "device" {
			return request, errors.New("investigation anchor kind must be ap or device")
		}
		if !macPattern.MatchString(request.Anchor.ID) {
			return request, errors.New("investigation anchor id must be a MAC address")
		}
		if request.Anchor.Kind == "ap" {
			request.APBSSID = request.Anchor.ID
		} else {
			request.DeviceMAC = request.Anchor.ID
		}
	}
	if request.APBSSID != "" && !macPattern.MatchString(request.APBSSID) {
		return request, errors.New("invalid AP BSSID")
	}
	if request.DeviceMAC != "" && !macPattern.MatchString(request.DeviceMAC) {
		return request, errors.New("invalid device MAC")
	}
	if request.APBSSID != "" && request.DeviceMAC != "" {
		return request, errors.New("investigation accepts one focused anchor")
	}
	if request.Anchor.Kind == "" {
		if request.APBSSID != "" {
			request.Anchor = InvestigationAnchor{Kind: "ap", ID: request.APBSSID}
		}
		if request.DeviceMAC != "" {
			request.Anchor = InvestigationAnchor{Kind: "device", ID: request.DeviceMAC}
		}
	}
	if request.ObservedBefore == nil {
		now := time.Now().UTC()
		request.ObservedBefore = &now
	}
	if request.ObservedAfter == nil {
		start := request.ObservedBefore.Add(-24 * time.Hour)
		request.ObservedAfter = &start
	}
	if !request.ObservedAfter.Before(*request.ObservedBefore) {
		return request, errors.New("observed_after must be before observed_before")
	}
	request.LocationIDs = normalizeGraphList(request.LocationIDs)
	request.SensorIDs = normalizeGraphList(request.SensorIDs)
	if request.NodeLimit <= 0 {
		request.NodeLimit = InvestigationDefaultNodes
	}
	if request.NodeLimit > InvestigationDefaultNodes {
		request.NodeLimit = InvestigationDefaultNodes
	}
	if request.EdgeLimit <= 0 {
		request.EdgeLimit = InvestigationDefaultEdges
	}
	if request.EdgeLimit > InvestigationDefaultEdges {
		request.EdgeLimit = InvestigationDefaultEdges
	}
	if request.EvidenceSize <= 0 {
		request.EvidenceSize = InvestigationDefaultRows
	}
	if request.EvidenceSize > InvestigationDefaultRows {
		request.EvidenceSize = InvestigationDefaultRows
	}
	if request.EvidencePage < 0 {
		return request, errors.New("evidence_page must not be negative")
	}
	return request, nil
}

func investigationScope(request InvestigationRequest, alias string) (string, []any) {
	return investigationScopeWith(request, alias, true)
}

// investigationScopeWith builds the summary-row scope for one alias. Pair
// queries pass deviceAnchor=false so they can express an anchor that appears on
// either side of the pair instead of only on this side.
func investigationScopeWith(request InvestigationRequest, alias string, deviceAnchor bool) (string, []any) {
	clauses := []string{fmt.Sprintf("%s.window_start >= $1", alias), fmt.Sprintf("%s.window_start < $2", alias)}
	args := []any{*request.ObservedAfter, *request.ObservedBefore}
	addInClause(&clauses, &args, alias+".location_id", stringsToAny(request.LocationIDs))
	addInClause(&clauses, &args, alias+".sensor_id", stringsToAny(request.SensorIDs))
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

func (s *Service) Investigation(ctx context.Context, request InvestigationRequest) (*InvestigationResponse, error) {
	request, err := normalizeInvestigationRequest(request)
	if err != nil {
		return nil, err
	}
	tx, err := s.Pool.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	freshness, err := investigationWatermarks(ctx, tx)
	if err != nil {
		return nil, err
	}
	scope, args := investigationScope(request, "summary")
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

func investigationWatermarks(ctx context.Context, tx *sql.Tx) (InvestigationFreshness, error) {
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
	result.SourceWatermark = nullTimePtr(source)
	result.ProjectionWatermark = nullTimePtr(projection)
	result.CoverageReason = reason.String
	return result, nil
}

func (s *Service) investigationRoster(ctx context.Context, tx *sql.Tx, scope string, args []any, request InvestigationRequest, response *InvestigationResponse, freshCutoff time.Time) error {
	queryArgs := append([]any{}, args...)
	queryArgs = append(queryArgs, request.NodeLimit)
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
	defer rows.Close()
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
	rows, err := tx.QueryContext(ctx, `SELECT window_start,sensor_id,COALESCE(location_id,''),bssid,source_mac,frame_count,rssi_sample_count,rssi_min_dbm,rssi_max_dbm,rssi_avg_dbm,first_observed_at,last_observed_at
FROM atheros_search.wireless_signal_summaries summary WHERE `+scope+` ORDER BY window_start DESC,sensor_id,bssid,source_mac LIMIT $`+fmt.Sprint(len(queryArgs)-1)+" OFFSET $"+fmt.Sprint(len(queryArgs)), queryArgs...)
	if err != nil {
		return err
	}
	defer rows.Close()
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
	rows, err := tx.QueryContext(ctx, `SELECT edge_id,source_node_id,target_node_id,observed_at FROM atheros_search.graph_edges
WHERE edge_kind='same_device' AND observed_at >= $1 AND source_node_id IN (`+pgPlaceholders(2, len(ids))+") AND target_node_id IN ("+pgPlaceholders(2+len(ids), len(ids))+") ORDER BY observed_at DESC,edge_id LIMIT $"+fmt.Sprint(2+len(ids)*2), append(append([]any{*request.ObservedAfter}, ids...), append(ids, remaining)...)...)
	if err != nil {
		return err
	}
	defer rows.Close()
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
	addInClause(&clauses, &args, "d.location_id", stringsToAny(request.LocationIDs))
	addInClause(&clauses, &args, "d.sensor_id", stringsToAny(request.SensorIDs))
	addInClause(&clauses, &args, "d.source_mac", stringsToAny(devices))
	addInClause(&clauses, &args, "d.bssid", stringsToAny(aps))
	args = append(args, remaining)
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
	defer rows.Close()
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

type rfOverlap struct {
	sensors int
	windows int
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
	addInClause(&clauses, &args, "a.source_mac", stringsToAny(devices))
	addInClause(&clauses, &args, "b.source_mac", stringsToAny(devices))
	if request.DeviceMAC != "" {
		clauses = append(clauses, fmt.Sprintf("(a.source_mac=$%d OR b.source_mac=$%d)", len(args)+1, len(args)+2))
		args = append(args, request.DeviceMAC, request.DeviceMAC)
	}
	clauses = append(clauses, "b.source_mac > a.source_mac")
	args = append(args, remaining)
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
	defer rows.Close()
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
		if qualifiesRFOverlap(overlap.sensors, overlap.windows) && len(response.Links) < request.EdgeLimit {
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
			Confidence:  rfConfidence(overlap.sensors, overlap.windows),
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

func qualifiesRFOverlap(sensors, windows int) bool {
	return sensors >= 2 && windows >= 2
}

func rfConfidence(sensors, windows int) string {
	return fmt.Sprintf("inferred from %d window(s) of overlap across %d sensors; a proximity hint, not a measured distance", windows, sensors)
}

// Evidence is intentionally the same bounded page returned by Investigation.
// Keeping a dedicated endpoint makes detail panels independent from graph reloads.
func (s *Service) Evidence(ctx context.Context, request InvestigationRequest) (*InvestigationResponse, error) {
	return s.Investigation(ctx, request)
}
