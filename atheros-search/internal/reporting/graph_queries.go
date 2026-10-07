package reporting

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/queryscope"
)

func graphNodePageWhere(filters GraphFilters, alias string) (string, []any) {
	clauses := []string{"1 = 1"}
	args := []any{}
	queryscope.AddInClause(&clauses, &args, alias+".location_id", queryscope.StringsToAny(filters.LocationIDs))
	queryscope.AddInClause(&clauses, &args, alias+".sensor_id", queryscope.StringsToAny(filters.SensorIDs))
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
		queryscope.AddInClause(&clauses, &args, alias+".node_kind", mapped)
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
FROM `+graphNodesTable(filters)+` n
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
	frontierPlaceholders := queryscope.PgPlaceholders(frontierStart, len(frontier))
	edgeClause := ""
	var edgeArgs []any
	if len(filters.EdgeKinds) > 0 {
		mapped := make([]any, 0, len(filters.EdgeKinds))
		for _, kind := range filters.EdgeKinds {
			mapped = append(mapped, graphEdgeKindToDB(kind))
		}
		edgeClause = fmt.Sprintf(" AND e.edge_kind IN (%s)", queryscope.PgPlaceholders(frontierStart+len(frontier), len(mapped)))
		edgeArgs = mapped
	}
	visitedStart := frontierStart + len(frontier) + len(edgeArgs)
	args := append([]any(nil), nodeArgs...)
	args = append(args, queryscope.StringsToAny(frontier)...)
	args = append(args, edgeArgs...)
	args = append(args, queryscope.StringsToAny(visited)...)
	// #nosec G202 -- clauses and placeholders are built from fixed SQL; all request values are passed in args.
	rows, err := tx.QueryContext(ctx, `
WITH filtered_nodes AS (
  SELECT n.node_id FROM `+graphNodesTable(filters)+` n WHERE `+nodeWhere+`
)
SELECT DISTINCT step.neighbor
FROM (
  SELECT CASE
           WHEN e.source_node_id IN (`+frontierPlaceholders+`) THEN e.target_node_id
           ELSE e.source_node_id
         END AS neighbor
  FROM `+graphEdgesTable(filters)+` e
  JOIN filtered_nodes source_node ON source_node.node_id = e.source_node_id
  JOIN filtered_nodes target_node ON target_node.node_id = e.target_node_id
  WHERE (e.source_node_id IN (`+frontierPlaceholders+`)
         OR e.target_node_id IN (`+frontierPlaceholders+`))`+edgeClause+`
) step
WHERE step.neighbor NOT IN (`+queryscope.PgPlaceholders(visitedStart, len(visited))+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }() // Release resources on early return; query, scan, and iteration errors are checked separately.
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
		queryscope.AddInClause(&edgeClauses, &args, "e.edge_kind", mapped)
	}
	return nodeWhere, args, strings.Join(edgeClauses, " AND ")
}

func countGraphPageEdges(ctx context.Context, tx *sql.Tx, nodeWhere string, nodeArgs []any, filters GraphFilters) (int, error) {
	_, args, edgeWhere := graphEdgePageQueryParts(nodeWhere, nodeArgs, filters)
	var count int
	err := tx.QueryRowContext(ctx, `
WITH filtered_nodes AS (
  SELECT n.node_id FROM `+graphNodesTable(filters)+` n WHERE `+nodeWhere+`
)
SELECT COUNT(*)
FROM `+graphEdgesTable(filters)+` e
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
	// #nosec G202 -- clauses and placeholders are built from fixed SQL; all request values are passed in args.
	rows, err := tx.QueryContext(ctx, `
WITH filtered_nodes AS (
  SELECT n.node_id FROM `+graphNodesTable(filters)+` n WHERE `+nodeWhere+`
)
SELECT e.edge_id, e.source_node_id, e.target_node_id, e.edge_kind, e.weight, e.weight_basis, e.label, e.observed_at, e.evidence::text
FROM `+graphEdgesTable(filters)+` e
JOIN filtered_nodes source_node ON source_node.node_id = e.source_node_id
JOIN filtered_nodes target_node ON target_node.node_id = e.target_node_id
WHERE `+edgeWhere+`
ORDER BY e.edge_id
LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = rows.Close() }() // Release resources on early return; query, scan, and iteration errors are checked separately.
	edges := make([]GraphEdge, 0, filters.PageSize+1)
	for rows.Next() {
		var row graphEdgeRow
		if err := rows.Scan(&row.EdgeID, &row.SourceID, &row.TargetID, &row.EdgeKind, &row.Weight, &row.WeightBasis, &row.Label, &row.ObservedAt, &row.Evidence); err != nil {
			return nil, false, err
		}
		edges = append(edges, graphEdgeFromRow(row, time.Now()))
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

func fetchGraphNodes(ctx context.Context, tx *sql.Tx, filters GraphFilters) ([]GraphNode, error) {
	clauses := []string{"1 = 1"}
	args := make([]any, 0)
	queryscope.AddInClause(&clauses, &args, "location_id", queryscope.StringsToAny(filters.LocationIDs))
	queryscope.AddInClause(&clauses, &args, "sensor_id", queryscope.StringsToAny(filters.SensorIDs))
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
		queryscope.AddInClause(&clauses, &args, "node_kind", mapped)
	}
	args = append(args, filters.Limit)

	// #nosec G202 -- clauses and placeholders are built from fixed SQL; all request values are passed in args.
	rows, err := tx.QueryContext(ctx, `
SELECT node_id, node_kind, label, COALESCE(node_payload::text, '{}'),
       location_id, sensor_id, normalized_mac, normalized_ssid,
       is_threat, observed_at
FROM `+graphNodesTable(filters)+` AS graph_nodes
WHERE `+strings.Join(clauses, " AND ")+`
ORDER BY observed_at DESC NULLS LAST, node_id
LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }() // Release resources on early return; query, scan, and iteration errors are checked separately.

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
		"source_node_id IN (" + queryscope.PgPlaceholders(1, len(nodeIDs)) + ")",
		"target_node_id IN (" + queryscope.PgPlaceholders(1, len(nodeIDs)) + ")",
	}
	if len(filters.EdgeKinds) > 0 {
		mapped := make([]any, 0, len(filters.EdgeKinds))
		for _, kind := range filters.EdgeKinds {
			mapped = append(mapped, graphEdgeKindToDB(kind))
		}
		start := len(args) + 1
		placeholders := queryscope.PgPlaceholders(start, len(mapped))
		clauses = append(clauses, fmt.Sprintf("edge_kind IN (%s)", placeholders))
		args = append(args, mapped...)
	}
	args = append(args, filters.Limit)
	where := "(" + strings.Join(clauses[:2], " OR ") + ")"
	if len(clauses) > 2 {
		where += " AND " + strings.Join(clauses[2:], " AND ")
	}
	// #nosec G202 -- clauses and placeholders are built from fixed SQL; all request values are passed in args.
	rows, err := tx.QueryContext(ctx, `
SELECT edge_id, source_node_id, target_node_id, edge_kind, weight, weight_basis, label, observed_at, evidence::text
FROM `+graphEdgesTable(filters)+` AS graph_edges
WHERE `+where+`
ORDER BY observed_at DESC NULLS LAST, edge_id
LIMIT $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }() // Release resources on early return; query, scan, and iteration errors are checked separately.

	edges := make([]GraphEdge, 0, len(nodes))
	for rows.Next() {
		var row graphEdgeRow
		if err := rows.Scan(&row.EdgeID, &row.SourceID, &row.TargetID, &row.EdgeKind, &row.Weight, &row.WeightBasis, &row.Label, &row.ObservedAt, &row.Evidence); err != nil {
			return nil, err
		}
		edges = append(edges, graphEdgeFromRow(row, time.Now()))
	}
	return edges, rows.Err()
}
