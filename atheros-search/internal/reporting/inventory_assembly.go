package reporting

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/queryscope"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/reportmeta"
)

func (s *Service) Inventory(ctx context.Context, filters InventoryFilters) (response *InventoryResponse, err error) {
	filters, err = normalizeInventoryFilters(filters)
	if err != nil {
		return nil, err
	}
	defer func() {
		if response != nil && response.Report == nil {
			loaded := 0
			for _, node := range response.Nodes {
				if node.Kind == InventoryNodeDevice {
					loaded++
				}
			}
			identity := filters
			identity.PageCursor = ""
			response.Report = reportmeta.New(identity, "observed MAC identifier", "distinct registry MACs; graph nodes also include grouping helpers", "registry observation timestamps; bounded projection", loaded, response.TotalDeviceCount)
		}
	}()
	if filters.Scope == "all" {
		return s.inventoryPage(ctx, filters)
	}
	if filters.Scope == "page" {
		return s.inventoryTablePage(ctx, filters)
	}
	tx, err := s.Pool.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }() // Cleanup after the operation; Commit errors are returned and an already committed transaction needs no rollback.
	devices, err := fetchInventoryDevices(ctx, tx, filters)
	if err != nil {
		return nil, err
	}
	var totalRegistered int
	where, countArgs := inventoryPageWhere(filters, "d")
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM atheros_search.devices d WHERE ("+where+") AND d.registered", countArgs...).Scan(&totalRegistered); err != nil {
		return nil, err
	}

	nodes := map[string]InventoryNode{}
	edges := map[string]InventoryEdge{}
	for _, device := range devices {
		addInventoryDevice(nodes, edges, device, filters.Grouping)
	}
	if filters.Grouping == InventoryGroupingSimilarity {
		if err := attachSimilarityInventory(ctx, tx, nodes, edges, filters); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	sortedNodes := make([]InventoryNode, 0, len(nodes))
	for _, node := range nodes {
		sortedNodes = append(sortedNodes, node)
	}
	sort.Slice(sortedNodes, func(i, j int) bool { return sortedNodes[i].ID < sortedNodes[j].ID })
	sortedEdges := make([]InventoryEdge, 0, len(edges))
	for _, edge := range edges {
		sortedEdges = append(sortedEdges, edge)
	}
	sort.Slice(sortedEdges, func(i, j int) bool { return sortedEdges[i].ID < sortedEdges[j].ID })
	return &InventoryResponse{
		Nodes:                sortedNodes,
		Edges:                sortedEdges,
		GeneratedAt:          time.Now().UTC(),
		NodeCount:            len(sortedNodes),
		EdgeCount:            len(sortedEdges),
		TotalRegisteredCount: totalRegistered,
	}, nil
}

func addStoredTagClauses(clauses *[]string, args *[]any, tags []string) {
	for _, tag := range tags {
		if isDerivedInventoryTag(tag) {
			continue
		}
		*clauses = append(*clauses, fmt.Sprintf("EXISTS (SELECT 1 FROM jsonb_array_elements_text(tags) AS stored_tag(value) WHERE lower(stored_tag.value) = $%d)", len(*args)+1))
		*args = append(*args, tag)
	}
}

func isDerivedInventoryTag(tag string) bool {
	return tag == "device" || tag == "registered" || tag == "active" || strings.HasPrefix(tag, "owner:") || strings.HasPrefix(tag, "location:")
}

func addInventoryDevice(nodes map[string]InventoryNode, edges map[string]InventoryEdge, device inventoryDeviceRow, grouping InventoryGrouping) {
	id := "device:" + strings.ToLower(device.MAC)
	label := device.DisplayName
	if label == "" {
		label = device.MAC
	}
	nodes[id] = InventoryNode{
		ID: id, Kind: InventoryNodeDevice, Label: label, MAC: device.MAC,
		KnownMACs: device.KnownMACs, DisplayName: device.DisplayName, OwnerID: device.OwnerID,
		LocationID: device.LocationID, FirstRegistered: device.FirstRegistered, LastSeen: device.LastSeen,
		Active: device.Active, Tags: device.Tags, Registered: &device.Registered,
	}
	if grouping != InventoryGroupingCMDB {
		return
	}
	if device.OwnerID != "" {
		ownerID := "owner:" + device.OwnerID
		nodes[ownerID] = InventoryNode{ID: ownerID, Kind: InventoryNodeOwner, Label: device.OwnerID, OwnerID: device.OwnerID, Active: true}
		edgeID := "owns:" + ownerID + ":" + id
		edges[edgeID] = InventoryEdge{ID: edgeID, Source: ownerID, Target: id, Kind: InventoryEdgeOwns}
	}
	if device.LocationID != "" {
		locationID := "location:" + device.LocationID
		nodes[locationID] = InventoryNode{ID: locationID, Kind: InventoryNodeLocationAsset, Label: device.LocationID, LocationID: device.LocationID, Active: true}
		edgeID := "located_at:" + id + ":" + locationID
		edges[edgeID] = InventoryEdge{ID: edgeID, Source: id, Target: locationID, Kind: InventoryEdgeLocatedAt}
	}
}

func inventoryDeviceTags(device *inventoryDeviceRow) []string {
	tags := append([]string{}, device.Tags...)
	tags = append(tags, "device")
	if device.Registered {
		tags = append(tags, "registered")
	}
	if device.Active {
		tags = append(tags, "active")
	}
	if device.OwnerID != "" {
		tags = append(tags, "owner:"+strings.ToLower(device.OwnerID))
	}
	if device.LocationID != "" {
		tags = append(tags, "location:"+strings.ToLower(device.LocationID))
	}
	return queryscope.NormalizeLowerList(tags)
}

func inventoryTagsMatch(actual, required []string) bool {
	for _, tag := range required {
		if !queryscope.ContainsFold(actual, tag) {
			return false
		}
	}
	return true
}

func (s *Service) inventoryPage(ctx context.Context, filters InventoryFilters) (*InventoryResponse, error) {
	fingerprintFilters := filters
	fingerprintFilters.PageCursor = ""
	fingerprintFilters.PageSize = 0
	fingerprintFilters.Limit = 0
	fingerprint, err := pageFingerprint(fingerprintFilters)
	if err != nil {
		return nil, err
	}
	cursor, err := decodePageCursor(filters.PageCursor, "inventory", fingerprint)
	if err != nil {
		return nil, err
	}
	tx, err := s.Pool.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }() // Cleanup after the operation; Commit errors are returned and an already committed transaction needs no rollback.

	where, args := inventoryPageWhere(filters, "d")
	var totalDevices, totalRegistered int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM atheros_search.devices d WHERE `+where, args...).Scan(&totalDevices); err != nil {
		return nil, err
	}
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM atheros_search.devices d WHERE ("+where+") AND d.registered", args...).Scan(&totalRegistered); err != nil {
		return nil, err
	}
	totalNodes, totalEdges, err := inventoryPageTotals(ctx, tx, filters, where, args, totalDevices)
	if err != nil {
		return nil, err
	}

	pageWhere := where
	pageArgs := append([]any(nil), args...)
	if cursor.DeviceAfter != "" {
		pageWhere += fmt.Sprintf(" AND d.mac > $%d", len(pageArgs)+1)
		pageArgs = append(pageArgs, cursor.DeviceAfter)
	}
	pageArgs = append(pageArgs, filters.PageSize+1)
	// #nosec G202 -- SQL fragments contain fixed clauses and placeholders; values are bound in args.
	rows, err := tx.QueryContext(ctx, `
SELECT d.mac, COALESCE(d.display_name, ''), COALESCE(d.owner_id, ''), COALESCE(d.location_id, ''),
       d.first_registered, d.last_seen, d.active, d.registered,
       COALESCE(d.tags::text, '[]'), COALESCE(d.known_macs::text, '[]')
FROM atheros_search.devices d
WHERE `+pageWhere+`
ORDER BY d.mac
LIMIT $`+fmt.Sprint(len(pageArgs)), pageArgs...)
	if err != nil {
		return nil, err
	}
	devices := make([]inventoryDeviceRow, 0, filters.PageSize+1)
	for rows.Next() {
		var row inventoryDeviceRow
		var first, last sql.NullTime
		var tagsJSON, knownMACsJSON string
		if err := rows.Scan(&row.MAC, &row.DisplayName, &row.OwnerID, &row.LocationID, &first, &last, &row.Active, &row.Registered, &tagsJSON, &knownMACsJSON); err != nil {
			_ = rows.Close()
			return nil, err
		}
		row.FirstRegistered = queryscope.NullTimePtr(first)
		row.LastSeen = queryscope.NullTimePtr(last)
		row.Tags = queryscope.ParseTagsJSON(tagsJSON)
		_ = json.Unmarshal([]byte(knownMACsJSON), &row.KnownMACs)
		row.Tags = inventoryDeviceTags(&row)
		devices = append(devices, row)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	more := len(devices) > filters.PageSize
	if more {
		devices = devices[:filters.PageSize]
	}

	nodeMap := map[string]InventoryNode{}
	edgeMap := map[string]InventoryEdge{}
	for _, device := range devices {
		addInventoryDevice(nodeMap, edgeMap, device, filters.Grouping)
	}
	if filters.Grouping == InventoryGroupingSimilarity {
		if err := attachSimilarityInventoryPage(ctx, tx, nodeMap, edgeMap, filters, devices); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	nodes := make([]InventoryNode, 0, len(nodeMap))
	for _, node := range nodeMap {
		nodes = append(nodes, node)
	}
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].ID < nodes[j].ID })
	edges := make([]InventoryEdge, 0, len(edgeMap))
	for _, edge := range edgeMap {
		edges = append(edges, edge)
	}
	sort.Slice(edges, func(i, j int) bool { return edges[i].ID < edges[j].ID })

	next := ""
	if more {
		cursor.DeviceAfter = devices[len(devices)-1].MAC
		next, err = encodePageCursor(cursor)
		if err != nil {
			return nil, err
		}
	}
	return &InventoryResponse{
		Nodes: nodes, Edges: edges, GeneratedAt: time.Now().UTC(), NodeCount: len(nodes), EdgeCount: len(edges),
		TotalRegisteredCount: totalRegistered, NextPageCursor: next,
		TotalNodeCount: &totalNodes, TotalEdgeCount: &totalEdges, TotalDeviceCount: &totalDevices,
	}, nil
}

func minimumInventoryConfidence(filters InventoryFilters) float64 {
	if filters.MinDedupConfidence == nil {
		return 0
	}
	return *filters.MinDedupConfidence
}

func attachSimilarityInventoryPage(ctx context.Context, tx *sql.Tx, nodes map[string]InventoryNode, edges map[string]InventoryEdge, filters InventoryFilters, devices []inventoryDeviceRow) error {
	if len(devices) == 0 {
		return nil
	}
	where, args := inventoryPageWhere(filters, "da")
	whereB, _ := inventoryPageWhere(filters, "db")
	macs := make([]any, 0, len(devices))
	for _, device := range devices {
		macs = append(macs, device.MAC)
	}
	confidencePlaceholder := len(args) + 1
	args = append(args, minimumInventoryConfidence(filters))
	anchorPlaceholders := queryscope.PgPlaceholders(len(args)+1, len(macs))
	args = append(args, macs...)
	// #nosec G202 -- SQL fragments contain fixed clauses and placeholders; values are bound in args.
	rows, err := tx.QueryContext(ctx, `
SELECT mc.candidate_id, mc.mac_a, mc.mac_b, mc.confidence,
       other.mac, COALESCE(other.display_name, ''), COALESCE(other.owner_id, ''), COALESCE(other.location_id, ''),
       other.first_registered, other.last_seen, other.active, other.registered,
       COALESCE(other.tags::text, '[]'), COALESCE(other.known_macs::text, '[]')
FROM atheros_search.merge_candidates mc
JOIN atheros_search.devices da ON da.mac = mc.mac_a
JOIN atheros_search.devices db ON db.mac = mc.mac_b
JOIN atheros_search.devices other ON other.mac = GREATEST(mc.mac_a, mc.mac_b)
WHERE mc.status = 'pending'
  AND mc.confidence >= $`+fmt.Sprint(confidencePlaceholder)+`
  AND (mc.expires_at IS NULL OR mc.expires_at > CURRENT_TIMESTAMP)
  AND (`+where+`) AND (`+whereB+`)
  AND LEAST(mc.mac_a, mc.mac_b) IN (`+anchorPlaceholders+`)
ORDER BY LEAST(mc.mac_a, mc.mac_b), mc.candidate_id`, args...)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }() // Release resources on early return; query, scan, and iteration errors are checked separately.
	for rows.Next() {
		var candidate pendingInventoryCandidate
		var other inventoryDeviceRow
		var first, last sql.NullTime
		var tagsJSON, knownMACsJSON string
		if err := rows.Scan(
			&candidate.id, &candidate.macA, &candidate.macB, &candidate.confidence,
			&other.MAC, &other.DisplayName, &other.OwnerID, &other.LocationID,
			&first, &last, &other.Active, &other.Registered, &tagsJSON, &knownMACsJSON,
		); err != nil {
			return err
		}
		other.FirstRegistered = queryscope.NullTimePtr(first)
		other.LastSeen = queryscope.NullTimePtr(last)
		other.Tags = queryscope.ParseTagsJSON(tagsJSON)
		_ = json.Unmarshal([]byte(knownMACsJSON), &other.KnownMACs)
		other.Tags = inventoryDeviceTags(&other)
		addInventoryDevice(nodes, edges, other, InventoryGroupingSimilarity)
		addSimilarityCandidate(nodes, edges, candidate)
	}
	return rows.Err()
}

func addSimilarityCandidate(nodes map[string]InventoryNode, edges map[string]InventoryEdge, candidate pendingInventoryCandidate) {
	deviceAID := "device:" + strings.ToLower(candidate.macA)
	deviceBID := "device:" + strings.ToLower(candidate.macB)
	deviceA, hasA := nodes[deviceAID]
	deviceB, hasB := nodes[deviceBID]
	if !hasA || !hasB {
		return
	}
	confidence := candidate.confidence
	candidateID := "merge:" + candidate.id
	clusterID := "cluster:" + candidate.id
	nodes[candidateID] = InventoryNode{ID: candidateID, Kind: InventoryNodeMergeCandidate, Label: candidate.macA + " / " + candidate.macB, Active: true, SimilarityClusterID: candidate.id, DedupConfidence: &confidence, Tags: []string{"merge-review"}}
	nodes[clusterID] = InventoryNode{ID: clusterID, Kind: InventoryNodeCluster, Label: "Similarity " + candidate.id[:min(8, len(candidate.id))], Active: true, SimilarityClusterID: candidate.id, Tags: []string{"similarity:pending"}}
	deviceA.SimilarityClusterID = candidate.id
	deviceA.DedupConfidence = &confidence
	nodes[deviceAID] = deviceA
	deviceB.SimilarityClusterID = candidate.id
	deviceB.DedupConfidence = &confidence
	nodes[deviceBID] = deviceB
	edges["merge_candidate:"+candidateID+":"+deviceAID] = InventoryEdge{ID: "merge_candidate:" + candidateID + ":" + deviceAID, Source: candidateID, Target: deviceAID, Kind: InventoryEdgeMergeCandidate, Weight: &confidence}
	edges["merge_candidate:"+candidateID+":"+deviceBID] = InventoryEdge{ID: "merge_candidate:" + candidateID + ":" + deviceBID, Source: candidateID, Target: deviceBID, Kind: InventoryEdgeMergeCandidate, Weight: &confidence}
	edges["candidate_pair:"+deviceAID+":"+deviceBID] = InventoryEdge{ID: "candidate_pair:" + deviceAID + ":" + deviceBID, Source: deviceAID, Target: deviceBID, Kind: InventoryEdgeCandidatePair, Weight: &confidence}
	edges["cluster_member:"+clusterID+":"+deviceAID] = InventoryEdge{ID: "cluster_member:" + clusterID + ":" + deviceAID, Source: deviceAID, Target: clusterID, Kind: InventoryEdgeClusterMember, Weight: &confidence}
	edges["cluster_member:"+clusterID+":"+deviceBID] = InventoryEdge{ID: "cluster_member:" + clusterID + ":" + deviceBID, Source: deviceBID, Target: clusterID, Kind: InventoryEdgeClusterMember, Weight: &confidence}
}

func attachSimilarityInventory(ctx context.Context, tx *sql.Tx, nodes map[string]InventoryNode, edges map[string]InventoryEdge, filters InventoryFilters) error {
	minConfidence := 0.0
	if filters.MinDedupConfidence != nil {
		minConfidence = *filters.MinDedupConfidence
	}
	// #nosec G202 -- SQL fragments contain fixed clauses and placeholders; values are bound in args.
	rows, err := tx.QueryContext(ctx, `
SELECT candidate_id, mac_a, mac_b, confidence
FROM atheros_search.merge_candidates
WHERE status = 'pending'
  AND confidence >= $1
  AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
ORDER BY confidence DESC, candidate_id
LIMIT $2`, minConfidence, filters.Limit)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }() // Release resources on early return; query, scan, and iteration errors are checked separately.

	type pendingCandidate struct {
		id         string
		macA       string
		macB       string
		confidence float64
	}
	candidates := make([]pendingCandidate, 0)
	for rows.Next() {
		var row pendingCandidate
		if err := rows.Scan(&row.id, &row.macA, &row.macB, &row.confidence); err != nil {
			return err
		}
		candidates = append(candidates, row)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, candidate := range candidates {
		deviceAID := "device:" + strings.ToLower(candidate.macA)
		deviceBID := "device:" + strings.ToLower(candidate.macB)
		deviceA, hasA := nodes[deviceAID]
		deviceB, hasB := nodes[deviceBID]
		if !hasA || !hasB {
			continue
		}
		if !devicePassesSimilarityFilters(deviceA, filters) || !devicePassesSimilarityFilters(deviceB, filters) {
			continue
		}
		confidence := candidate.confidence
		candidateID := "merge:" + candidate.id
		clusterID := "cluster:" + candidate.id
		nodes[candidateID] = InventoryNode{
			ID:                  candidateID,
			Kind:                InventoryNodeMergeCandidate,
			Label:               candidate.macA + " / " + candidate.macB,
			Active:              true,
			SimilarityClusterID: candidate.id,
			DedupConfidence:     &confidence,
			Tags:                []string{"merge-review"},
		}
		nodes[clusterID] = InventoryNode{
			ID:                  clusterID,
			Kind:                InventoryNodeCluster,
			Label:               "Similarity " + candidate.id[:min(8, len(candidate.id))],
			Active:              true,
			SimilarityClusterID: candidate.id,
			Tags:                []string{"similarity:pending"},
		}
		deviceA.SimilarityClusterID = candidate.id
		deviceA.DedupConfidence = &confidence
		nodes[deviceAID] = deviceA
		deviceB.SimilarityClusterID = candidate.id
		deviceB.DedupConfidence = &confidence
		nodes[deviceBID] = deviceB

		edgeA := "merge_candidate:" + candidateID + ":" + deviceAID
		edges[edgeA] = InventoryEdge{ID: edgeA, Source: candidateID, Target: deviceAID, Kind: InventoryEdgeMergeCandidate, Weight: &confidence}
		edgeB := "merge_candidate:" + candidateID + ":" + deviceBID
		edges[edgeB] = InventoryEdge{ID: edgeB, Source: candidateID, Target: deviceBID, Kind: InventoryEdgeMergeCandidate, Weight: &confidence}
		pair := "candidate_pair:" + deviceAID + ":" + deviceBID
		edges[pair] = InventoryEdge{ID: pair, Source: deviceAID, Target: deviceBID, Kind: InventoryEdgeCandidatePair, Weight: &confidence}
		clusterEdgeA := "cluster_member:" + clusterID + ":" + deviceAID
		edges[clusterEdgeA] = InventoryEdge{ID: clusterEdgeA, Source: deviceAID, Target: clusterID, Kind: InventoryEdgeClusterMember, Weight: &confidence}
		clusterEdgeB := "cluster_member:" + clusterID + ":" + deviceBID
		edges[clusterEdgeB] = InventoryEdge{ID: clusterEdgeB, Source: deviceBID, Target: clusterID, Kind: InventoryEdgeClusterMember, Weight: &confidence}
	}
	return nil
}

func devicePassesSimilarityFilters(device InventoryNode, filters InventoryFilters) bool {
	if filters.ActiveOnly && !device.Active {
		return false
	}
	if len(filters.LocationIDs) > 0 && device.LocationID != "" && !queryscope.ContainsFold(filters.LocationIDs, device.LocationID) {
		return false
	}
	if len(filters.OwnerIDs) > 0 && device.OwnerID != "" && !queryscope.ContainsFold(filters.OwnerIDs, device.OwnerID) {
		return false
	}
	if !inventoryTagsMatch(device.Tags, filters.Tags) {
		return false
	}
	return true
}
