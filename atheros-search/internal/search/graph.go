package search

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	graphDefaultLimit = 200
	graphMaxLimit     = 1000
	graphMaxHops      = 2
)

type GraphFilters struct {
	LocationIDs    []string   `json:"location_ids,omitempty"`
	SensorIDs      []string   `json:"sensor_ids,omitempty"`
	SourceMAC      string     `json:"source_mac,omitempty"`
	SSID           string     `json:"ssid,omitempty"`
	Kinds          []string   `json:"kinds,omitempty"`
	EdgeKinds      []string   `json:"edge_kinds,omitempty"`
	ThreatOnly     bool       `json:"threat_only,omitempty"`
	ObservedAfter  *time.Time `json:"observed_after,omitempty"`
	ObservedBefore *time.Time `json:"observed_before,omitempty"`
	Hops           int        `json:"hops,omitempty"`
	Limit          int        `json:"limit,omitempty"`
	Scope          string     `json:"scope,omitempty"`
	PageCursor     string     `json:"page_cursor,omitempty"`
	PageSize       int        `json:"page_size,omitempty"`
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
	ID          string   `json:"id"`
	Source      string   `json:"source"`
	Target      string   `json:"target"`
	Kind        string   `json:"kind"`
	Weight      *float64 `json:"weight,omitempty"`
	WeightBasis string   `json:"weight_basis,omitempty"`
	Label       string   `json:"label,omitempty"`
}

type GraphResponse struct {
	Nodes          []GraphNode `json:"nodes"`
	Edges          []GraphEdge `json:"edges"`
	GeneratedAt    time.Time   `json:"generated_at"`
	NodeCount      int         `json:"node_count"`
	EdgeCount      int         `json:"edge_count"`
	NextPageCursor string      `json:"next_page_cursor,omitempty"`
	TotalNodeCount *int        `json:"total_node_count,omitempty"`
	TotalEdgeCount *int        `json:"total_edge_count,omitempty"`
}

// Graph queries projected identity-graph rows for the Integration Console.
func (s *Service) Graph(ctx context.Context, filters GraphFilters) (*GraphResponse, error) {
	filters, err := normalizeGraphFilters(filters)
	if err != nil {
		return nil, err
	}
	if filters.Scope == "all" {
		return s.graphPage(ctx, filters)
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
		nodes, edges = focusGraphAroundMAC(nodes, edges, filters.SourceMAC, filters.Hops)
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

	nodeKind := make(map[string]string, len(sortedNodes))
	nodeCountByKind := make(map[string]int, len(sortedNodes))
	for _, node := range sortedNodes {
		nodeKind[node.ID] = node.Kind
		nodeCountByKind[node.Kind]++
	}
	degreeByKind := make(map[string]int, len(nodeCountByKind))
	for _, edge := range sortedEdges {
		if kind, ok := nodeKind[edge.Source]; ok {
			degreeByKind[kind]++
		}
		if kind, ok := nodeKind[edge.Target]; ok {
			degreeByKind[kind]++
		}
	}
	if s.Metrics != nil {
		for kind, degree := range degreeByKind {
			if count := nodeCountByKind[kind]; count > 0 {
				s.Metrics.ObserveGraphEdgeDensity(kind, float64(degree)/float64(count))
			}
		}
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
	filters.Scope = strings.TrimSpace(filters.Scope)
	if filters.Scope != "" && filters.Scope != "all" {
		return filters, fmt.Errorf("unsupported scope %q", filters.Scope)
	}
	if filters.Scope == "" && filters.PageCursor != "" {
		return filters, errors.New("page_cursor requires scope all")
	}
	if filters.Scope == "all" {
		filters.PageSize = normalizePageSize(filters.PageSize)
	}
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
	mappedEdgeKinds := make([]string, 0, len(filters.EdgeKinds))
	seenEdgeKinds := map[string]struct{}{}
	for _, kind := range filters.EdgeKinds {
		kind = strings.TrimSpace(kind)
		if kind == "" {
			continue
		}
		mapped := mapGraphEdgeKind(kind)
		if _, ok := seenEdgeKinds[mapped]; ok {
			continue
		}
		seenEdgeKinds[mapped] = struct{}{}
		mappedEdgeKinds = append(mappedEdgeKinds, mapped)
	}
	filters.EdgeKinds = mappedEdgeKinds
	if filters.Hops < 1 {
		filters.Hops = 1
	}
	if filters.Hops > graphMaxHops {
		filters.Hops = graphMaxHops
	}
	return filters, nil
}

func (s *Service) graphPage(ctx context.Context, filters GraphFilters) (*GraphResponse, error) {
	fingerprintFilters := filters
	fingerprintFilters.PageCursor = ""
	fingerprintFilters.PageSize = 0
	fingerprintFilters.Limit = 0
	fingerprint, err := pageFingerprint(fingerprintFilters)
	if err != nil {
		return nil, err
	}
	cursor, err := decodePageCursor(filters.PageCursor, "graph", fingerprint)
	if err != nil {
		return nil, err
	}
	tx, err := s.Pool.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	nodeWhere, nodeArgs := graphNodePageWhere(filters, "n")
	focusIDs, err := graphFocusNodeIDs(ctx, tx, filters)
	if err != nil {
		return nil, err
	}
	if len(focusIDs) > 0 {
		nodeWhere += " AND n.node_id IN (" + pgPlaceholders(len(nodeArgs)+1, len(focusIDs)) + ")"
		nodeArgs = append(nodeArgs, focusIDs...)
	}
	var totalNodes int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM atheros_search.graph_nodes n WHERE `+nodeWhere, nodeArgs...).Scan(&totalNodes); err != nil {
		return nil, err
	}
	totalEdges, err := countGraphPageEdges(ctx, tx, nodeWhere, nodeArgs, filters)
	if err != nil {
		return nil, err
	}

	nodes := []GraphNode{}
	nodesMore := false
	if !cursor.NodesDone {
		pageWhere := nodeWhere
		pageArgs := append([]any(nil), nodeArgs...)
		if cursor.NodeAfter != "" {
			pageWhere += fmt.Sprintf(" AND n.node_id > $%d", len(pageArgs)+1)
			pageArgs = append(pageArgs, cursor.NodeAfter)
		}
		pageArgs = append(pageArgs, filters.PageSize+1)
		rows, queryErr := tx.QueryContext(ctx, `
SELECT n.node_id, n.node_kind, n.label, COALESCE(n.node_payload::text, '{}'),
       n.location_id, n.sensor_id, n.normalized_mac, n.normalized_ssid,
       n.is_threat, n.observed_at
FROM atheros_search.graph_nodes n
WHERE `+pageWhere+`
ORDER BY n.node_id
LIMIT $`+fmt.Sprint(len(pageArgs)), pageArgs...)
		if queryErr != nil {
			return nil, queryErr
		}
		for rows.Next() {
			var row graphNodeRow
			if err := rows.Scan(&row.NodeID, &row.NodeKind, &row.Label, &row.NodePayload, &row.LocationID, &row.SensorID, &row.NormalizedMAC, &row.NormalizedSSID, &row.IsThreat, &row.ObservedAt); err != nil {
				_ = rows.Close()
				return nil, err
			}
			nodes = append(nodes, graphNodeFromRow(row))
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			return nil, err
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
		if len(nodes) > filters.PageSize {
			nodesMore = true
			nodes = nodes[:filters.PageSize]
		}
	}

	edges, edgesMore, err := fetchGraphEdgePage(ctx, tx, nodeWhere, nodeArgs, filters, cursor.EdgeAfter, cursor.EdgesDone)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	next := ""
	if nodesMore || edgesMore {
		cursor.NodesDone = !nodesMore
		cursor.EdgesDone = !edgesMore
		if len(nodes) > 0 {
			cursor.NodeAfter = nodes[len(nodes)-1].ID
		}
		if len(edges) > 0 {
			cursor.EdgeAfter = edges[len(edges)-1].ID
		}
		next, err = encodePageCursor(cursor)
		if err != nil {
			return nil, err
		}
	}
	return &GraphResponse{
		Nodes: nodes, Edges: edges, GeneratedAt: time.Now().UTC(),
		NodeCount: len(nodes), EdgeCount: len(edges), NextPageCursor: next,
		TotalNodeCount: &totalNodes, TotalEdgeCount: &totalEdges,
	}, nil
}

func graphNodePageWhere(filters GraphFilters, alias string) (string, []any) {
	clauses := []string{"1 = 1"}
	args := []any{}
	addInClause(&clauses, &args, alias+".location_id", stringsToAny(filters.LocationIDs))
	addInClause(&clauses, &args, alias+".sensor_id", stringsToAny(filters.SensorIDs))
	if filters.ThreatOnly {
		clauses = append(clauses, alias+".is_threat")
	}
	if filters.SSID != "" {
		clauses = append(clauses, fmt.Sprintf("%s.normalized_ssid = $%d", alias, len(args)+1))
		args = append(args, filters.SSID)
	}
	if filters.ObservedAfter != nil {
		clauses = append(clauses, fmt.Sprintf("%s.observed_at >= $%d", alias, len(args)+1))
		args = append(args, *filters.ObservedAfter)
	}
	if filters.ObservedBefore != nil {
		clauses = append(clauses, fmt.Sprintf("%s.observed_at < $%d", alias, len(args)+1))
		args = append(args, *filters.ObservedBefore)
	}
	if len(filters.Kinds) > 0 {
		mapped := make([]any, 0, len(filters.Kinds))
		for _, kind := range filters.Kinds {
			mapped = append(mapped, graphNodeKindToDB(kind))
		}
		addInClause(&clauses, &args, alias+".node_kind", mapped)
	}
	return strings.Join(clauses, " AND "), args
}

// graphFocusNodeIDs resolves the source MAC neighborhood within the filtered
// graph so paginated scope:"all" requests keep the legacy focus contract.
// It returns no IDs when the anchor node is absent from the filtered graph.
func graphFocusNodeIDs(ctx context.Context, tx *sql.Tx, filters GraphFilters) ([]any, error) {
	if filters.SourceMAC == "" {
		return nil, nil
	}
	nodeWhere, nodeArgs := graphNodePageWhere(filters, "n")
	mac := strings.ToLower(filters.SourceMAC)
	anchorArgs := append(append([]any(nil), nodeArgs...), "device:"+mac, mac)
	anchorPlaceholder := len(nodeArgs) + 1
	var anchor string
	err := tx.QueryRowContext(ctx, `
SELECT n.node_id
FROM atheros_search.graph_nodes n
WHERE (`+nodeWhere+`)
  AND (n.node_id = $`+fmt.Sprint(anchorPlaceholder)+`
       OR lower(COALESCE(n.normalized_mac, '')) = $`+fmt.Sprint(anchorPlaceholder+1)+`)
LIMIT 1`, anchorArgs...).Scan(&anchor)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	visited := []string{anchor}
	frontier := []string{anchor}
	for hop := 0; hop < filters.Hops && len(frontier) > 0; hop++ {
		neighbors, err := graphNeighborIDs(ctx, tx, filters, frontier, visited)
		if err != nil {
			return nil, err
		}
		if len(neighbors) == 0 {
			break
		}
		visited = append(visited, neighbors...)
		frontier = neighbors
	}
	ids := make([]any, 0, len(visited))
	for _, id := range visited {
		ids = append(ids, id)
	}
	return ids, nil
}

func graphNeighborIDs(ctx context.Context, tx *sql.Tx, filters GraphFilters, frontier, visited []string) ([]string, error) {
	nodeWhere, nodeArgs := graphNodePageWhere(filters, "n")
	frontierStart := len(nodeArgs) + 1
	frontierPlaceholders := pgPlaceholders(frontierStart, len(frontier))
	edgeClause := ""
	var edgeArgs []any
	if len(filters.EdgeKinds) > 0 {
		mapped := make([]any, 0, len(filters.EdgeKinds))
		for _, kind := range filters.EdgeKinds {
			mapped = append(mapped, graphEdgeKindToDB(kind))
		}
		edgeClause = fmt.Sprintf(" AND e.edge_kind IN (%s)", pgPlaceholders(frontierStart+len(frontier), len(mapped)))
		edgeArgs = mapped
	}
	visitedStart := frontierStart + len(frontier) + len(edgeArgs)
	args := append([]any(nil), nodeArgs...)
	args = append(args, stringsToAny(frontier)...)
	args = append(args, edgeArgs...)
	args = append(args, stringsToAny(visited)...)
	rows, err := tx.QueryContext(ctx, `
WITH filtered_nodes AS (
  SELECT n.node_id FROM atheros_search.graph_nodes n WHERE `+nodeWhere+`
)
SELECT DISTINCT step.neighbor
FROM (
  SELECT CASE
           WHEN e.source_node_id IN (`+frontierPlaceholders+`) THEN e.target_node_id
           ELSE e.source_node_id
         END AS neighbor
  FROM atheros_search.graph_edges e
  JOIN filtered_nodes source_node ON source_node.node_id = e.source_node_id
  JOIN filtered_nodes target_node ON target_node.node_id = e.target_node_id
  WHERE (e.source_node_id IN (`+frontierPlaceholders+`)
         OR e.target_node_id IN (`+frontierPlaceholders+`))`+edgeClause+`
) step
WHERE step.neighbor NOT IN (`+pgPlaceholders(visitedStart, len(visited))+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	neighbors := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		neighbors = append(neighbors, id)
	}
	return neighbors, rows.Err()
}

func graphEdgePageQueryParts(nodeWhere string, nodeArgs []any, filters GraphFilters) (string, []any, string) {
	args := append([]any(nil), nodeArgs...)
	edgeClauses := []string{"1 = 1"}
	if len(filters.EdgeKinds) > 0 {
		mapped := make([]any, 0, len(filters.EdgeKinds))
		for _, kind := range filters.EdgeKinds {
			mapped = append(mapped, graphEdgeKindToDB(kind))
		}
		addInClause(&edgeClauses, &args, "e.edge_kind", mapped)
	}
	return nodeWhere, args, strings.Join(edgeClauses, " AND ")
}

func countGraphPageEdges(ctx context.Context, tx *sql.Tx, nodeWhere string, nodeArgs []any, filters GraphFilters) (int, error) {
	_, args, edgeWhere := graphEdgePageQueryParts(nodeWhere, nodeArgs, filters)
	var count int
	err := tx.QueryRowContext(ctx, `
WITH filtered_nodes AS (
  SELECT n.node_id FROM atheros_search.graph_nodes n WHERE `+nodeWhere+`
)
SELECT COUNT(*)
FROM atheros_search.graph_edges e
JOIN filtered_nodes source_node ON source_node.node_id = e.source_node_id
JOIN filtered_nodes target_node ON target_node.node_id = e.target_node_id
WHERE `+edgeWhere, args...).Scan(&count)
	return count, err
}

func fetchGraphEdgePage(ctx context.Context, tx *sql.Tx, nodeWhere string, nodeArgs []any, filters GraphFilters, after string, done bool) ([]GraphEdge, bool, error) {
	if done {
		return []GraphEdge{}, false, nil
	}
	_, args, edgeWhere := graphEdgePageQueryParts(nodeWhere, nodeArgs, filters)
	if after != "" {
		edgeWhere += fmt.Sprintf(" AND e.edge_id > $%d", len(args)+1)
		args = append(args, after)
	}
	args = append(args, filters.PageSize+1)
	rows, err := tx.QueryContext(ctx, `
WITH filtered_nodes AS (
  SELECT n.node_id FROM atheros_search.graph_nodes n WHERE `+nodeWhere+`
)
SELECT e.edge_id, e.source_node_id, e.target_node_id, e.edge_kind, e.weight, e.weight_basis, e.label, e.observed_at
FROM atheros_search.graph_edges e
JOIN filtered_nodes source_node ON source_node.node_id = e.source_node_id
JOIN filtered_nodes target_node ON target_node.node_id = e.target_node_id
WHERE `+edgeWhere+`
ORDER BY e.edge_id
LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	edges := make([]GraphEdge, 0, filters.PageSize+1)
	for rows.Next() {
		var row graphEdgeRow
		if err := rows.Scan(&row.EdgeID, &row.SourceID, &row.TargetID, &row.EdgeKind, &row.Weight, &row.WeightBasis, &row.Label, &row.ObservedAt); err != nil {
			return nil, false, err
		}
		edges = append(edges, GraphEdge{ID: row.EdgeID, Source: row.SourceID, Target: row.TargetID, Kind: mapGraphEdgeKind(row.EdgeKind), Weight: &row.Weight, WeightBasis: row.WeightBasis.String, Label: row.Label.String})
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	more := len(edges) > filters.PageSize
	if more {
		edges = edges[:filters.PageSize]
	}
	return edges, more, nil
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

func graphEdgeKindToDB(kind string) string {
	switch kind {
	case "association":
		return "observed_at"
	case "cluster_member":
		return "identity_member"
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
	EdgeID      string
	SourceID    string
	TargetID    string
	EdgeKind    string
	Weight      float64
	WeightBasis sql.NullString
	Label       sql.NullString
	ObservedAt  sql.NullTime
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
	clauses := []string{
		"source_node_id IN (" + pgPlaceholders(1, len(nodeIDs)) + ")",
		"target_node_id IN (" + pgPlaceholders(1, len(nodeIDs)) + ")",
	}
	if len(filters.EdgeKinds) > 0 {
		mapped := make([]any, 0, len(filters.EdgeKinds))
		for _, kind := range filters.EdgeKinds {
			mapped = append(mapped, graphEdgeKindToDB(kind))
		}
		start := len(args) + 1
		placeholders := pgPlaceholders(start, len(mapped))
		clauses = append(clauses, fmt.Sprintf("edge_kind IN (%s)", placeholders))
		args = append(args, mapped...)
	}
	args = append(args, filters.Limit)
	where := "(" + strings.Join(clauses[:2], " OR ") + ")"
	if len(clauses) > 2 {
		where += " AND " + strings.Join(clauses[2:], " AND ")
	}
	rows, err := tx.QueryContext(ctx, `
SELECT edge_id, source_node_id, target_node_id, edge_kind, weight, weight_basis, label, observed_at
FROM atheros_search.graph_edges
WHERE `+where+`
ORDER BY observed_at DESC NULLS LAST, edge_id
LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	edges := make([]GraphEdge, 0, len(nodes))
	for rows.Next() {
		var row graphEdgeRow
		if err := rows.Scan(&row.EdgeID, &row.SourceID, &row.TargetID, &row.EdgeKind, &row.Weight, &row.WeightBasis, &row.Label, &row.ObservedAt); err != nil {
			return nil, err
		}
		edge := GraphEdge{
			ID:          row.EdgeID,
			Source:      row.SourceID,
			Target:      row.TargetID,
			Kind:        mapGraphEdgeKind(row.EdgeKind),
			Weight:      &row.Weight,
			WeightBasis: row.WeightBasis.String,
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

func focusGraphAroundMAC(nodes []GraphNode, edges []GraphEdge, mac string, hops int) ([]GraphNode, []GraphEdge) {
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
	frontier := []string{deviceID}
	for hop := 0; hop < hops && len(frontier) > 0; hop++ {
		frontierSet := make(map[string]struct{}, len(frontier))
		for _, id := range frontier {
			frontierSet[id] = struct{}{}
		}
		next := make([]string, 0)
		for _, edge := range edges {
			var neighbor string
			if _, ok := frontierSet[edge.Source]; ok {
				neighbor = edge.Target
			} else if _, ok := frontierSet[edge.Target]; ok {
				neighbor = edge.Source
			} else {
				continue
			}
			if _, ok := related[neighbor]; ok {
				continue
			}
			related[neighbor] = struct{}{}
			next = append(next, neighbor)
		}
		frontier = next
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
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].ID < sorted[j].ID })
	return sorted
}

func sortGraphEdges(edges []GraphEdge) []GraphEdge {
	sorted := append([]GraphEdge(nil), edges...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].ID < sorted[j].ID })
	return sorted
}
