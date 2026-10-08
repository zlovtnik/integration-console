package reporting

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/queryscope"
)

func resolveGraphRoot(ctx context.Context, tx *sql.Tx, filters GraphFilters) (string, error) {
	rootFilters := filters
	rootFilters.Kinds = nil
	rootFilters.ThreatOnly = false
	where, args := graphNodePageWhere(rootFilters, "n")
	order := "COALESCE(ap.authorized, false) DESC, ap.last_observed_at DESC NULLS LAST, n.observed_at DESC NULLS LAST, n.node_id"
	switch {
	case filters.RootNodeID != "":
		where += fmt.Sprintf(" AND n.node_id = $%d", len(args)+1)
		args = append(args, filters.RootNodeID)
	case filters.RootBSSID != "":
		where += fmt.Sprintf(" AND n.node_kind = 'access_point' AND (n.node_id = $%d OR lower(n.normalized_mac) = $%d)", len(args)+1, len(args)+2)
		args = append(args, "ap:"+filters.RootBSSID, filters.RootBSSID)
	case filters.SourceMAC != "":
		where += fmt.Sprintf(" AND (n.node_id = $%d OR lower(n.normalized_mac) = $%d)", len(args)+1, len(args)+2)
		args = append(args, "device:"+filters.SourceMAC, filters.SourceMAC)
		order = "(n.node_kind = 'device') DESC, " + order
	default:
		// An AP is preferred, but a scope containing only unattached entities
		// still has a visible forest rather than an empty graph.
		order = "(n.node_kind = 'access_point') DESC, " + order
	}
	var root string
	// #nosec G202 -- fixed table/ordering fragments and generated placeholders; all filter values are bound.
	err := tx.QueryRowContext(ctx, `
SELECT n.node_id FROM `+graphNodesTable(filters)+` n
LEFT JOIN atheros_search.ap_catalog ap ON n.node_kind = 'access_point'
 AND (lower(n.normalized_mac) = ap.bssid OR n.node_id = 'ap:' || ap.bssid)
WHERE `+where+`
ORDER BY `+order+`
LIMIT 1`, args...).Scan(&root)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return root, err
}

func fetchGraphHierarchyNodes(ctx context.Context, tx *sql.Tx, filters GraphFilters, rootID string) ([]GraphNode, int, int, error) {
	where, args := graphNodePageWhere(filters, "n")
	rootPlaceholder := fmt.Sprintf("$%d", len(args)+1)
	args = append(args, rootID, filters.Limit)
	// Default-root forest: include every filtered node, not only unassociated
	// devices/clients, so disconnected AP neighborhoods stay visible. Walk
	// nodes remain ordered first via the existing ORDER BY.
	remainingForest := ""
	if filters.RootNodeID == "" && filters.RootBSSID == "" && filters.SourceMAC == "" {
		remainingForest = ` UNION SELECT n.node_id FROM filtered_nodes n`
	}
	// UNION on node_id is the cycle guard: each reachable node enters the walk
	// once, regardless of the number of paths. This avoids path enumeration and
	// any hop limit on AP fan-out. Root and its immediate neighbors are selected
	// first if the explicit node cap is reached.
	// #nosec G202 -- fixed SQL fragments and generated placeholders; all request values are bound.
	rows, err := tx.QueryContext(ctx, `
WITH RECURSIVE filtered_nodes AS (
 SELECT n.node_id, n.node_kind, n.label, n.node_payload, n.location_id, n.sensor_id,
        n.normalized_mac, n.normalized_ssid, n.is_threat, n.observed_at
 FROM `+graphNodesTable(filters)+` n WHERE (`+where+`) OR n.node_id = `+rootPlaceholder+`
), associations AS (
 SELECT e.source_node_id, e.target_node_id
 FROM `+graphEdgesTable(filters)+` e
 JOIN filtered_nodes source_node ON source_node.node_id = e.source_node_id
 JOIN filtered_nodes target_node ON target_node.node_id = e.target_node_id
 WHERE e.edge_kind IN ('observed_at', 'observed_association')
), walk(node_id) AS (
 SELECT node_id FROM filtered_nodes WHERE node_id = `+rootPlaceholder+`
 UNION
 SELECT CASE WHEN e.source_node_id = w.node_id THEN e.target_node_id ELSE e.source_node_id END
 FROM walk w JOIN associations e ON e.source_node_id = w.node_id OR e.target_node_id = w.node_id
), selected_nodes AS (
 SELECT node_id FROM walk`+remainingForest+`
)
SELECT n.node_id, n.node_kind, n.label, COALESCE(n.node_payload::text, '{}'),
       n.location_id, n.sensor_id, n.normalized_mac, n.normalized_ssid,
       n.is_threat, n.observed_at, (SELECT COUNT(*) FROM selected_nodes),
       (SELECT COUNT(*) FROM `+graphEdgesTable(filters)+` e
        LEFT JOIN `+graphNodesTable(filters)+` source_node ON source_node.node_id = e.source_node_id
        LEFT JOIN `+graphNodesTable(filters)+` target_node ON target_node.node_id = e.target_node_id
        WHERE e.edge_kind IN ('observed_at', 'observed_association')
         AND (source_node.node_id IS NULL OR target_node.node_id IS NULL)
         AND (e.source_node_id IN (SELECT node_id FROM selected_nodes) OR e.target_node_id IN (SELECT node_id FROM selected_nodes)))
FROM filtered_nodes n JOIN selected_nodes selected ON selected.node_id = n.node_id
ORDER BY (n.node_id = `+rootPlaceholder+`) DESC,
 EXISTS (SELECT 1 FROM associations e WHERE
  (e.source_node_id = `+rootPlaceholder+` AND e.target_node_id = n.node_id) OR
  (e.target_node_id = `+rootPlaceholder+` AND e.source_node_id = n.node_id)) DESC,
 (n.node_id IN (SELECT node_id FROM walk)) DESC, n.node_id
LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, 0, 0, err
	}
	defer func() { _ = rows.Close() }() // Release rows on error; scan and iteration errors are returned.
	nodes := make([]GraphNode, 0, filters.Limit)
	total := 0
	missingRelationships := 0
	for rows.Next() {
		var row graphNodeRow
		if err := rows.Scan(&row.NodeID, &row.NodeKind, &row.Label, &row.NodePayload, &row.LocationID, &row.SensorID,
			&row.NormalizedMAC, &row.NormalizedSSID, &row.IsThreat, &row.ObservedAt, &total, &missingRelationships); err != nil {
			return nil, 0, 0, err
		}
		nodes = append(nodes, graphNodeFromRow(row))
	}
	return nodes, total, missingRelationships, rows.Err()
}

func fetchGraphHierarchyEdges(ctx context.Context, tx *sql.Tx, filters GraphFilters, nodes []GraphNode) ([]GraphEdge, error) {
	if len(nodes) == 0 {
		return []GraphEdge{}, nil
	}
	args := make([]any, 0, len(nodes))
	for _, node := range nodes {
		args = append(args, node.ID)
	}
	ids := queryscope.PgPlaceholders(1, len(args))
	// Hierarchy edge filters are visual layers, not pagination. Include every
	// relationship within the closed node set so multiple parents remain evidence.
	// #nosec G202 -- table names are fixed projection fragments and IDs are bound parameters.
	rows, err := tx.QueryContext(ctx, `
SELECT edge_id, source_node_id, target_node_id, edge_kind, weight, weight_basis, label, observed_at, evidence::text
FROM `+graphEdgesTable(filters)+` e
WHERE source_node_id IN (`+ids+`) AND target_node_id IN (`+ids+`)
ORDER BY edge_id`, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }() // Release rows on error; scan and iteration errors are returned.
	edges := []GraphEdge{}
	for rows.Next() {
		var row graphEdgeRow
		if err := rows.Scan(&row.EdgeID, &row.SourceID, &row.TargetID, &row.EdgeKind, &row.Weight, &row.WeightBasis, &row.Label, &row.ObservedAt, &row.Evidence); err != nil {
			return nil, err
		}
		edges = append(edges, graphEdgeFromRow(row, time.Now()))
	}
	return edges, rows.Err()
}

// completeGraphEdgeEndpoints augments an overview page with the node rows for
// its edge page. These rows may repeat on later pages; consumers merge by ID.
func completeGraphEdgeEndpoints(ctx context.Context, tx *sql.Tx, filters GraphFilters, nodes []GraphNode, edges []GraphEdge) ([]GraphNode, error) {
	known := make(map[string]bool, len(nodes))
	for _, node := range nodes {
		known[node.ID] = true
	}
	missing := []any{}
	for _, edge := range edges {
		for _, id := range []string{edge.Source, edge.Target} {
			if !known[id] {
				known[id] = true
				missing = append(missing, id)
			}
		}
	}
	if len(missing) == 0 {
		return nodes, nil
	}
	// #nosec G202 -- fixed projection table and generated placeholders; IDs are bound.
	rows, err := tx.QueryContext(ctx, `
SELECT n.node_id, n.node_kind, n.label, COALESCE(n.node_payload::text, '{}'),
       n.location_id, n.sensor_id, n.normalized_mac, n.normalized_ssid, n.is_threat, n.observed_at
FROM `+graphNodesTable(filters)+` n WHERE n.node_id IN (`+queryscope.PgPlaceholders(1, len(missing))+`)
ORDER BY n.node_id`, missing...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }() // Release rows on error; scan and iteration errors are returned.
	for rows.Next() {
		var row graphNodeRow
		if err := rows.Scan(&row.NodeID, &row.NodeKind, &row.Label, &row.NodePayload, &row.LocationID, &row.SensorID,
			&row.NormalizedMAC, &row.NormalizedSSID, &row.IsThreat, &row.ObservedAt); err != nil {
			return nil, err
		}
		nodes = append(nodes, graphNodeFromRow(row))
	}
	return nodes, rows.Err()
}
