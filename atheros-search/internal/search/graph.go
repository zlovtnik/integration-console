package search

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const (
	graphDefaultLimit = 200
	graphMaxLimit     = 1000
)

type GraphFilters struct {
	LocationIDs    []string   `json:"location_ids,omitempty"`
	SensorIDs      []string   `json:"sensor_ids,omitempty"`
	SourceMAC      string     `json:"source_mac,omitempty"`
	SSID           string     `json:"ssid,omitempty"`
	Kinds          []string   `json:"kinds,omitempty"`
	ThreatOnly     bool       `json:"threat_only,omitempty"`
	ObservedAfter  *time.Time `json:"observed_after,omitempty"`
	ObservedBefore *time.Time `json:"observed_before,omitempty"`
	Limit          int        `json:"limit,omitempty"`
}

type GraphNode struct {
	ID               string     `json:"id"`
	Kind             string     `json:"kind"`
	Label            string     `json:"label"`
	MAC              string     `json:"mac,omitempty"`
	DisplayName      string     `json:"display_name,omitempty"`
	Username         string     `json:"username,omitempty"`
	Hostname         string     `json:"hostname,omitempty"`
	OSHint           string     `json:"os_hint,omitempty"`
	SSID             string     `json:"ssid,omitempty"`
	BSSID            string     `json:"bssid,omitempty"`
	LocationID       string     `json:"location_id,omitempty"`
	SensorID         string     `json:"sensor_id,omitempty"`
	ClusterSize      *int       `json:"cluster_size,omitempty"`
	RiskScore        *float64   `json:"risk_score,omitempty"`
	AlertType        string     `json:"alert_type,omitempty"`
	AlertSeverity    string     `json:"alert_severity,omitempty"`
	Threat           bool       `json:"threat,omitempty"`
	ExplainSourceKey string     `json:"explain_source_key,omitempty"`
	ExplainKind      string     `json:"explain_kind,omitempty"`
	ObservedAt       *time.Time `json:"created_at,omitempty"`
	FirstSeen        *time.Time `json:"first_seen,omitempty"`
	LastSeen         *time.Time `json:"last_seen,omitempty"`
	Tags             []string   `json:"tags,omitempty"`
}

type GraphEdge struct {
	ID     string   `json:"id"`
	Source string   `json:"source"`
	Target string   `json:"target"`
	Kind   string   `json:"kind"`
	Weight *float64 `json:"weight,omitempty"`
	Label  string   `json:"label,omitempty"`
}

type GraphResponse struct {
	Nodes       []GraphNode `json:"nodes"`
	Edges       []GraphEdge `json:"edges"`
	GeneratedAt time.Time   `json:"generated_at"`
	NodeCount   int         `json:"node_count"`
	EdgeCount   int         `json:"edge_count"`
}

// Graph queries projected identity-graph rows for the Integration Console.
func (s *Service) Graph(ctx context.Context, filters GraphFilters) (*GraphResponse, error) {
	filters, err := normalizeGraphFilters(filters)
	if err != nil {
		return nil, err
	}

	tx, err := s.Pool.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	nodes, err := fetchGraphNodes(ctx, tx, filters)
	if err != nil {
		return nil, err
	}
	if filters.SourceMAC != "" && !graphHasMAC(nodes, filters.SourceMAC) {
		anchor, err := fetchGraphNodes(ctx, tx, anchorGraphFilters(filters))
		if err != nil {
			return nil, err
		}
		nodes = append(anchor, nodes...)
	}
	edges, err := fetchGraphEdges(ctx, tx, filters, nodes)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	if filters.SourceMAC != "" {
		nodes, edges = focusGraphAroundMAC(nodes, edges, filters.SourceMAC)
	}

	sortedNodes := sortGraphNodes(nodes)
	sortedEdges := sortGraphEdges(edges)
	if len(sortedNodes) > filters.Limit {
		sortedNodes = sortedNodes[:filters.Limit]
		keep := make(map[string]struct{}, len(sortedNodes))
		for _, node := range sortedNodes {
			keep[node.ID] = struct{}{}
		}
		filtered := sortedEdges[:0]
		for _, edge := range sortedEdges {
			_, sourceOK := keep[edge.Source]
			_, targetOK := keep[edge.Target]
			if sourceOK && targetOK {
				filtered = append(filtered, edge)
			}
		}
		sortedEdges = filtered
	}

	return &GraphResponse{
		Nodes:       sortedNodes,
		Edges:       sortedEdges,
		GeneratedAt: time.Now().UTC(),
		NodeCount:   len(sortedNodes),
		EdgeCount:   len(sortedEdges),
	}, nil
}

func normalizeGraphFilters(filters GraphFilters) (GraphFilters, error) {
	if filters.Limit <= 0 {
		filters.Limit = graphDefaultLimit
	}
	if filters.Limit > graphMaxLimit {
		filters.Limit = graphMaxLimit
	}
	if filters.ObservedAfter != nil && filters.ObservedBefore != nil && !filters.ObservedAfter.Before(*filters.ObservedBefore) {
		return filters, fmt.Errorf("observed_after must be before observed_before")
	}
	filters.LocationIDs = normalizeGraphList(filters.LocationIDs)
	filters.SensorIDs = normalizeGraphList(filters.SensorIDs)
	filters.SourceMAC = strings.ToLower(strings.TrimSpace(filters.SourceMAC))
	filters.SSID = strings.TrimSpace(filters.SSID)
	mappedKinds := make([]string, 0, len(filters.Kinds))
	seen := map[string]struct{}{}
	for _, kind := range filters.Kinds {
		kind = strings.TrimSpace(kind)
		if kind == "" {
			continue
		}
		mapped := mapGraphNodeKind(kind)
		if _, ok := seen[mapped]; ok {
			continue
		}
		seen[mapped] = struct{}{}
		mappedKinds = append(mappedKinds, mapped)
	}
	filters.Kinds = mappedKinds
	return filters, nil
}

func mapGraphNodeKind(kind string) string {
	switch kind {
	case "access_point":
		return "ap"
	case "identity_cluster":
		return "cluster"
	case "ap":
		return "ap"
	case "cluster":
		return "cluster"
	default:
		return kind
	}
}

func mapGraphEdgeKind(kind string) string {
	switch kind {
	case "observed_at":
		return "association"
	case "identity_member":
		return "cluster_member"
	default:
		return kind
	}
}

type graphNodeRow struct {
	NodeID         string
	NodeKind       string
	Label          sql.NullString
	NodePayload    string
	LocationID     sql.NullString
	SensorID       sql.NullString
	NormalizedMAC  sql.NullString
	NormalizedSSID sql.NullString
	IsThreat       bool
	ObservedAt     sql.NullTime
}

func fetchGraphNodes(ctx context.Context, tx *sql.Tx, filters GraphFilters) ([]GraphNode, error) {
	clauses := []string{"1 = 1"}
	args := make([]any, 0)
	addInClause(&clauses, &args, "location_id", stringsToAny(filters.LocationIDs))
	addInClause(&clauses, &args, "sensor_id", stringsToAny(filters.SensorIDs))
	if filters.ThreatOnly {
		clauses = append(clauses, "is_threat")
	}
	if filters.SSID != "" {
		clauses = append(clauses, fmt.Sprintf("normalized_ssid = $%d", len(args)+1))
		args = append(args, filters.SSID)
	}
	if filters.ObservedAfter != nil {
		clauses = append(clauses, fmt.Sprintf("observed_at >= $%d", len(args)+1))
		args = append(args, *filters.ObservedAfter)
	}
	if filters.ObservedBefore != nil {
		clauses = append(clauses, fmt.Sprintf("observed_at < $%d", len(args)+1))
		args = append(args, *filters.ObservedBefore)
	}
	if len(filters.Kinds) > 0 {
		mapped := make([]any, 0, len(filters.Kinds))
		for _, kind := range filters.Kinds {
			mapped = append(mapped, graphNodeKindToDB(kind))
		}
		addInClause(&clauses, &args, "node_kind", mapped)
	}
	args = append(args, filters.Limit)

	rows, err := tx.QueryContext(ctx, `
SELECT node_id, node_kind, label, COALESCE(node_payload::text, '{}'),
       location_id, sensor_id, normalized_mac, normalized_ssid,
       is_threat, observed_at
FROM atheros_search.graph_nodes
WHERE `+strings.Join(clauses, " AND ")+`
ORDER BY observed_at DESC NULLS LAST, node_id
LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	nodes := make([]GraphNode, 0, filters.Limit)
	for rows.Next() {
		var row graphNodeRow
		if err := rows.Scan(
			&row.NodeID, &row.NodeKind, &row.Label, &row.NodePayload,
			&row.LocationID, &row.SensorID, &row.NormalizedMAC, &row.NormalizedSSID,
			&row.IsThreat, &row.ObservedAt,
		); err != nil {
			return nil, err
		}
		nodes = append(nodes, graphNodeFromRow(row))
	}
	return nodes, rows.Err()
}

func graphNodeKindToDB(kind string) string {
	switch kind {
	case "ap":
		return "access_point"
	case "cluster":
		return "identity_cluster"
	default:
		return kind
	}
}

func graphNodeFromRow(row graphNodeRow) GraphNode {
	node := GraphNode{
		ID:    row.NodeID,
		Kind:  mapGraphNodeKind(row.NodeKind),
		Label: row.NodeID,
	}
	if row.Label.Valid && strings.TrimSpace(row.Label.String) != "" {
		node.Label = row.Label.String
	}
	if row.LocationID.Valid {
		node.LocationID = row.LocationID.String
	}
	if row.SensorID.Valid {
		node.SensorID = row.SensorID.String
	}
	if row.NormalizedMAC.Valid {
		node.MAC = row.NormalizedMAC.String
	}
	if row.NormalizedSSID.Valid {
		node.SSID = row.NormalizedSSID.String
	}
	node.Threat = row.IsThreat
	if row.ObservedAt.Valid {
		utc := row.ObservedAt.Time.UTC()
		node.ObservedAt = &utc
		node.FirstSeen = &utc
		node.LastSeen = &utc
	}

	var payload map[string]any
	if err := json.Unmarshal([]byte(row.NodePayload), &payload); err == nil {
		if mac, ok := payload["mac"].(string); ok && mac != "" {
			node.MAC = mac
		}
		if bssid, ok := payload["bssid"].(string); ok && bssid != "" {
			node.BSSID = bssid
		}
		if name, ok := payload["display_name"].(string); ok && name != "" {
			node.DisplayName = name
		}
		if size, ok := payload["cluster_size"].(float64); ok {
			clusterSize := int(size)
			node.ClusterSize = &clusterSize
		}
		if username, ok := payload["username"].(string); ok && username != "" {
			node.Username = username
		}
		if hostname, ok := payload["hostname"].(string); ok && hostname != "" {
			node.Hostname = hostname
		}
		if osHint, ok := payload["os_hint"].(string); ok && osHint != "" {
			node.OSHint = osHint
		}
		if risk, ok := payload["risk_score"].(float64); ok && risk > 0 {
			node.RiskScore = &risk
		}
		if alertType, ok := payload["alert_type"].(string); ok && alertType != "" {
			node.AlertType = alertType
		}
		if alertSeverity, ok := payload["alert_severity"].(string); ok && alertSeverity != "" {
			node.AlertSeverity = alertSeverity
		}
		if explainKey, ok := payload["explain_source_key"].(string); ok && explainKey != "" {
			node.ExplainSourceKey = explainKey
		}
		if explainKind, ok := payload["explain_kind"].(string); ok && explainKind != "" {
			node.ExplainKind = explainKind
		}
	}
	if node.DisplayName == "" && node.Kind == "device" {
		node.DisplayName = node.Label
	}
	if node.BSSID == "" && strings.HasPrefix(node.ID, "ap:") {
		node.BSSID = strings.TrimPrefix(node.ID, "ap:")
	}
	return node
}

type graphEdgeRow struct {
	EdgeID     string
	SourceID   string
	TargetID   string
	EdgeKind   string
	Weight     float64
	Label      sql.NullString
	ObservedAt sql.NullTime
}

func fetchGraphEdges(ctx context.Context, tx *sql.Tx, filters GraphFilters, nodes []GraphNode) ([]GraphEdge, error) {
	if len(nodes) == 0 {
		return nil, nil
	}
	nodeIDs := make([]any, 0, len(nodes))
	for _, node := range nodes {
		nodeIDs = append(nodeIDs, node.ID)
	}
	args := append([]any(nil), nodeIDs...)
	args = append(args, filters.Limit)
	placeholders := pgPlaceholders(1, len(nodeIDs))
	rows, err := tx.QueryContext(ctx, `
SELECT edge_id, source_node_id, target_node_id, edge_kind, weight, label, observed_at
FROM atheros_search.graph_edges
WHERE source_node_id IN (`+placeholders+`)
   OR target_node_id IN (`+placeholders+`)
ORDER BY observed_at DESC NULLS LAST, edge_id
LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	edges := make([]GraphEdge, 0, len(nodes))
	for rows.Next() {
		var row graphEdgeRow
		if err := rows.Scan(&row.EdgeID, &row.SourceID, &row.TargetID, &row.EdgeKind, &row.Weight, &row.Label, &row.ObservedAt); err != nil {
			return nil, err
		}
		edge := GraphEdge{
			ID:     row.EdgeID,
			Source: row.SourceID,
			Target: row.TargetID,
			Kind:   mapGraphEdgeKind(row.EdgeKind),
			Weight: &row.Weight,
		}
		if row.Label.Valid {
			edge.Label = row.Label.String
		}
		edges = append(edges, edge)
	}
	return edges, rows.Err()
}

func graphHasMAC(nodes []GraphNode, mac string) bool {
	for _, node := range nodes {
		if node.ID == "device:"+strings.ToLower(mac) || strings.EqualFold(node.MAC, mac) {
			return true
		}
	}
	return false
}

func anchorGraphFilters(filters GraphFilters) GraphFilters {
	anchor := GraphFilters{
		SourceMAC: filters.SourceMAC,
		Limit:     1,
	}
	return anchor
}

func focusGraphAroundMAC(nodes []GraphNode, edges []GraphEdge, mac string) ([]GraphNode, []GraphEdge) {
	deviceID := "device:" + strings.ToLower(mac)
	found := false
	for _, node := range nodes {
		if node.ID == deviceID || (node.MAC != "" && strings.EqualFold(node.MAC, mac)) {
			found = true
			deviceID = node.ID
			break
		}
	}
	if !found {
		return nodes, edges
	}

	related := map[string]struct{}{deviceID: {}}
	for _, edge := range edges {
		if edge.Source == deviceID {
			related[edge.Target] = struct{}{}
		}
		if edge.Target == deviceID {
			related[edge.Source] = struct{}{}
		}
	}
	filteredNodes := make([]GraphNode, 0, len(related))
	for _, node := range nodes {
		if _, ok := related[node.ID]; ok {
			filteredNodes = append(filteredNodes, node)
		}
	}
	filteredEdges := make([]GraphEdge, 0, len(edges))
	for _, edge := range edges {
		_, sourceOK := related[edge.Source]
		_, targetOK := related[edge.Target]
		if sourceOK && targetOK {
			filteredEdges = append(filteredEdges, edge)
		}
	}
	return filteredNodes, filteredEdges
}

func sortGraphNodes(nodes []GraphNode) []GraphNode {
	sorted := append([]GraphNode(nil), nodes...)
	for i := 1; i < len(sorted); i++ {
		for j := i; j > 0 && sorted[j].ID < sorted[j-1].ID; j-- {
			sorted[j], sorted[j-1] = sorted[j-1], sorted[j]
		}
	}
	return sorted
}

func sortGraphEdges(edges []GraphEdge) []GraphEdge {
	sorted := append([]GraphEdge(nil), edges...)
	for i := 1; i < len(sorted); i++ {
		for j := i; j > 0 && sorted[j].ID < sorted[j-1].ID; j-- {
			sorted[j], sorted[j-1] = sorted[j-1], sorted[j]
		}
	}
	return sorted
}
