package reporting

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/queryscope"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/reportmeta"
)

// Graph queries projected identity-graph rows for the Integration Console.
func (s *Service) Graph(ctx context.Context, filters GraphFilters) (response *GraphResponse, err error) {
	if filters.Projection == "" && s.WirelessProjection {
		filters.Projection = "stream"
	}
	filters, err = NormalizeGraphFilters(filters)
	if err != nil {
		return nil, err
	}
	defer func() {
		if response != nil {
			scope := filters
			scope.PageCursor = ""
			response.Report = reportmeta.New(scope, "projected graph entity", "graph nodes (mixed entity kinds), not a physical asset count", "latest graph timestamps and cumulative edge evidence; historical interval absence cannot be established", len(response.Nodes), response.TotalNodeCount)
		}
	}()
	if filters.Scope == "all" {
		return s.graphPage(ctx, filters)
	}
	if filters.SourceMAC != "" {
		filters.Scope = "all"
		filters.PageSize = filters.Limit
		return s.graphPage(ctx, filters)
	}

	tx, err := s.Pool.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }() // Cleanup after the operation; Commit errors are returned and an already committed transaction needs no rollback.

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
	defer func() { _ = tx.Rollback() }() // Cleanup after the operation; Commit errors are returned and an already committed transaction needs no rollback.

	nodeWhere, nodeArgs := graphNodePageWhere(filters, "n")
	focusIDs, err := graphFocusNodeIDs(ctx, tx, filters)
	if err != nil {
		return nil, err
	}
	if len(focusIDs) > 0 {
		nodeWhere += " AND n.node_id IN (" + queryscope.PgPlaceholders(len(nodeArgs)+1, len(focusIDs)) + ")"
		nodeArgs = append(nodeArgs, focusIDs...)
	} else if filters.SourceMAC != "" {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		zero := 0
		return &GraphResponse{Nodes: []GraphNode{}, Edges: []GraphEdge{}, GeneratedAt: time.Now().UTC(), TotalNodeCount: &zero, TotalEdgeCount: &zero, FocusReason: "Identifier not found in the selected projection scope."}, nil
	}
	var totalNodes int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM `+graphNodesTable(filters)+` n WHERE `+nodeWhere, nodeArgs...).Scan(&totalNodes); err != nil {
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
		// #nosec G202 -- pageWhere contains fixed clauses and placeholders; user data is passed in pageArgs.
		rows, queryErr := tx.QueryContext(ctx, `
SELECT n.node_id, n.node_kind, n.label, COALESCE(n.node_payload::text, '{}'),
       n.location_id, n.sensor_id, n.normalized_mac, n.normalized_ssid,
       n.is_threat, n.observed_at
FROM `+graphNodesTable(filters)+` n
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

func graphHasMAC(nodes []GraphNode, mac string) bool {
	for _, node := range nodes {
		if node.ID == "device:"+strings.ToLower(mac) || strings.EqualFold(node.MAC, mac) {
			return true
		}
	}
	return false
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
		return []GraphNode{}, []GraphEdge{}
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
