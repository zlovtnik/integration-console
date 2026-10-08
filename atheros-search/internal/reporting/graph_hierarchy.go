package reporting

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

func (s *Service) graphHierarchy(ctx context.Context, filters GraphFilters) (*GraphResponse, error) {
	tx, err := s.Pool.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }() // Best-effort cleanup; query and commit errors are returned.
	rootID, err := resolveGraphRoot(ctx, tx, filters)
	if err != nil {
		return nil, err
	}
	if rootID == "" {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		zero := 0
		return &GraphResponse{
			Nodes: []GraphNode{}, Edges: []GraphEdge{}, GeneratedAt: time.Now().UTC(),
			TotalNodeCount: &zero, TotalEdgeCount: &zero,
			Hierarchy:   &GraphHierarchy{RootIDs: []string{}},
			FocusReason: "Root not found in the selected projection scope.",
		}, nil
	}
	nodes, totalNodes, missingRelationships, err := fetchGraphHierarchyNodes(ctx, tx, filters, rootID)
	if err != nil {
		return nil, err
	}
	// The node cap is explicit; edges are never independently capped. Retain all
	// relationships between the returned nodes, including secondary evidence.
	edges, err := fetchGraphHierarchyEdges(ctx, tx, filters, nodes)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	nodes, edges, hierarchy := buildPresentationTree(nodes, edges, rootID)
	hierarchy.Truncated = totalNodes > len(nodes)
	if hierarchy.Truncated {
		hierarchy.Reason = fmt.Sprintf("Node limit %d reached; showing %d of %d nodes in the root neighborhood.", filters.Limit, len(nodes), totalNodes)
	}
	if missingRelationships > 0 {
		hierarchy.Truncated = true
		if hierarchy.Reason != "" {
			hierarchy.Reason += " "
		}
		hierarchy.Reason += fmt.Sprintf("%d association relationships reference missing projected nodes.", missingRelationships)
	}
	return &GraphResponse{
		Nodes: nodes, Edges: edges, Hierarchy: hierarchy, GeneratedAt: time.Now().UTC(),
		NodeCount: len(nodes), EdgeCount: len(edges), TotalNodeCount: &totalNodes,
		FocusReason: hierarchy.Reason,
	}, nil
}

func isGraphAssociation(kind string) bool {
	return kind == "association" || kind == "observed_at" || kind == "observed_association"
}

// buildPresentationTree creates an undirected spanning forest from association
// evidence. PostgreSQL stores device -> AP observations; presentation parents
// instead point from a chosen root toward its children. Stable ID ordering
// makes the first discovered parent deterministic, even with cycles.
func buildPresentationTree(nodes []GraphNode, edges []GraphEdge, rootID string) ([]GraphNode, []GraphEdge, *GraphHierarchy) {
	nodes = sortGraphNodes(nodes)
	edges = sortGraphEdges(edges)
	byID := make(map[string]int, len(nodes))
	for i := range nodes {
		byID[nodes[i].ID] = i
		nodes[i].ParentID = nil
		nodes[i].Depth = nil
		nodes[i].Role = nodes[i].Kind
		if nodes[i].Kind == "device" {
			nodes[i].Role = "client"
		}
	}
	closedEdges := make([]GraphEdge, 0, len(edges))
	for _, edge := range edges {
		_, sourceOK := byID[edge.Source]
		_, targetOK := byID[edge.Target]
		if sourceOK && targetOK {
			edge.TreeRole = "secondary"
			closedEdges = append(closedEdges, edge)
		}
	}
	edges = closedEdges
	adjacency := make(map[string][]int, len(nodes))
	for i, edge := range edges {
		if isGraphAssociation(edge.Kind) && edge.Source != edge.Target {
			adjacency[edge.Source] = append(adjacency[edge.Source], i)
			adjacency[edge.Target] = append(adjacency[edge.Target], i)
		}
	}
	hierarchy := &GraphHierarchy{RootID: rootID, RootIDs: []string{}}
	visited := make(map[string]bool, len(nodes))
	visit := func(id string) {
		hierarchy.RootIDs = append(hierarchy.RootIDs, id)
		depth := 0
		nodes[byID[id]].Depth = &depth
		visited[id] = true
		queue := []string{id}
		for head := 0; head < len(queue); head++ {
			parent := queue[head]
			for _, edgeIndex := range adjacency[parent] {
				edge := &edges[edgeIndex]
				child := edge.Source
				if child == parent {
					child = edge.Target
				}
				if visited[child] {
					continue
				}
				visited[child] = true
				parentID := parent
				childDepth := *nodes[byID[parent]].Depth + 1
				nodes[byID[child]].ParentID = &parentID
				nodes[byID[child]].Depth = &childDepth
				edge.TreeRole = "tree"
				queue = append(queue, child)
			}
		}
	}
	if i, ok := byID[rootID]; ok {
		visit(rootID)
		if nodes[i].Kind == "ap" {
			nodes[i].Role = "root_ap"
		} else {
			nodes[i].Role = "root"
		}
	}
	// Additional APs lead any disconnected components; isolated devices remain
	// explicit forest roots instead of disappearing from the payload.
	for _, kind := range []string{"ap", ""} {
		for _, node := range nodes {
			if !visited[node.ID] && (kind == "" || node.Kind == kind) {
				visit(node.ID)
			}
		}
	}
	return nodes, edges, hierarchy
}
