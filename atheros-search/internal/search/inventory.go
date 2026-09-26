package search

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	inventoryDefaultLimit = 400
	inventoryMaxLimit     = 1000
)

type InventoryGrouping string

const (
	InventoryGroupingRegistry   InventoryGrouping = "registry"
	InventoryGroupingCMDB       InventoryGrouping = "cmdb"
	InventoryGroupingSimilarity InventoryGrouping = "similarity"
)

type InventoryNodeKind string

const (
	InventoryNodeDevice         InventoryNodeKind = "device"
	InventoryNodeOwner          InventoryNodeKind = "owner"
	InventoryNodeLocationAsset  InventoryNodeKind = "location_asset"
	InventoryNodeCluster        InventoryNodeKind = "cluster"
	InventoryNodeMergeCandidate InventoryNodeKind = "merge_candidate"
)

type InventoryEdgeKind string

const (
	InventoryEdgeOwns           InventoryEdgeKind = "owns"
	InventoryEdgeLocatedAt      InventoryEdgeKind = "located_at"
	InventoryEdgeClusterMember  InventoryEdgeKind = "cluster_member"
	InventoryEdgeMergeCandidate InventoryEdgeKind = "merge_candidate"
	InventoryEdgeSameDevice     InventoryEdgeKind = "same_device"
)

type InventoryFilters struct {
	Grouping           InventoryGrouping `json:"grouping"`
	LocationIDs        []string          `json:"location_ids,omitempty"`
	OwnerIDs           []string          `json:"owner_ids,omitempty"`
	ActiveOnly         bool              `json:"active_only,omitempty"`
	MinDedupConfidence *float64          `json:"min_dedup_confidence,omitempty"`
	Tags               []string          `json:"tags,omitempty"`
	Limit              int               `json:"limit,omitempty"`
	Scope              string            `json:"scope,omitempty"`
	PageCursor         string            `json:"page_cursor,omitempty"`
	PageSize           int               `json:"page_size,omitempty"`
}

type InventoryNode struct {
	ID                  string            `json:"id"`
	Kind                InventoryNodeKind `json:"kind"`
	Label               string            `json:"label"`
	MAC                 string            `json:"mac,omitempty"`
	KnownMACs           []string          `json:"known_macs,omitempty"`
	DisplayName         string            `json:"display_name,omitempty"`
	OwnerID             string            `json:"owner_id,omitempty"`
	LocationID          string            `json:"location_id,omitempty"`
	FirstRegistered     *time.Time        `json:"first_registered,omitempty"`
	LastSeen            *time.Time        `json:"last_seen,omitempty"`
	Active              bool              `json:"active"`
	SimilarityClusterID string            `json:"similarity_cluster_id,omitempty"`
	DedupConfidence     *float64          `json:"dedup_confidence,omitempty"`
	Tags                []string          `json:"tags,omitempty"`
}

type InventoryEdge struct {
	ID     string            `json:"id"`
	Source string            `json:"source"`
	Target string            `json:"target"`
	Kind   InventoryEdgeKind `json:"kind"`
	Weight *float64          `json:"weight,omitempty"`
}

type InventoryResponse struct {
	Nodes                []InventoryNode `json:"nodes"`
	Edges                []InventoryEdge `json:"edges"`
	GeneratedAt          time.Time       `json:"generated_at"`
	NodeCount            int             `json:"node_count"`
	EdgeCount            int             `json:"edge_count"`
	TotalRegisteredCount int             `json:"total_registered_count"`
	NextPageCursor       string          `json:"next_page_cursor,omitempty"`
	TotalNodeCount       *int            `json:"total_node_count,omitempty"`
	TotalEdgeCount       *int            `json:"total_edge_count,omitempty"`
	TotalDeviceCount     *int            `json:"total_device_count,omitempty"`
}

type inventoryDeviceRow struct {
	MAC             string
	DisplayName     string
	OwnerID         string
	LocationID      string
	FirstRegistered *time.Time
	LastSeen        *time.Time
	Active          bool
	Registered      bool
	Tags            []string
	KnownMACs       []string
}

func (s *Service) Inventory(ctx context.Context, filters InventoryFilters) (*InventoryResponse, error) {
	filters, err := normalizeInventoryFilters(filters)
	if err != nil {
		return nil, err
	}
	if filters.Scope == "all" {
		return s.inventoryPage(ctx, filters)
	}
	tx, err := s.Pool.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	devices, err := fetchInventoryDevices(ctx, tx, filters)
	if err != nil {
		return nil, err
	}
	var totalRegistered int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM atheros_search.devices WHERE registered").Scan(&totalRegistered); err != nil {
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

func fetchInventoryDevices(ctx context.Context, tx *sql.Tx, filters InventoryFilters) ([]inventoryDeviceRow, error) {
	clauses := []string{"1 = 1"}
	args := make([]any, 0)
	addInClause(&clauses, &args, "location_id", stringsToAny(filters.LocationIDs))
	addInClause(&clauses, &args, "owner_id", stringsToAny(filters.OwnerIDs))
	if filters.ActiveOnly {
		clauses = append(clauses, "active")
	}
	addStoredTagClauses(&clauses, &args, filters.Tags)
	devices := make([]inventoryDeviceRow, 0, filters.Limit)
	var cursorLastSeen time.Time
	var cursorMAC string
	for len(devices) < filters.Limit {
		pageClauses := append([]string(nil), clauses...)
		pageArgs := append([]any(nil), args...)
		if !cursorLastSeen.IsZero() {
			pageClauses = append(pageClauses, fmt.Sprintf("(last_seen < $%d OR (last_seen = $%d AND mac > $%d))", len(pageArgs)+1, len(pageArgs)+1, len(pageArgs)+2))
			pageArgs = append(pageArgs, cursorLastSeen, cursorMAC)
		}
		pageArgs = append(pageArgs, filters.Limit)
		rows, err := tx.QueryContext(ctx, `
SELECT
  mac, COALESCE(display_name, ''), COALESCE(owner_id, ''), COALESCE(location_id, ''),
  first_registered, last_seen, active, registered,
  COALESCE(tags::text, '[]'), COALESCE(known_macs::text, '[]')
FROM atheros_search.devices
WHERE `+strings.Join(pageClauses, " AND ")+`
ORDER BY last_seen DESC, mac ASC
		LIMIT $`+fmt.Sprint(len(pageArgs)), pageArgs...)
		if err != nil {
			return nil, err
		}
		pageRows := 0
		for rows.Next() {
			var row inventoryDeviceRow
			var first, last sql.NullTime
			var tagsJSON, knownMACsJSON string
			if err := rows.Scan(
				&row.MAC, &row.DisplayName, &row.OwnerID, &row.LocationID,
				&first, &last, &row.Active, &row.Registered,
				&tagsJSON, &knownMACsJSON,
			); err != nil {
				_ = rows.Close()
				return nil, err
			}
			pageRows++
			cursorLastSeen = last.Time
			cursorMAC = row.MAC
			row.FirstRegistered = nullTimePtr(first)
			row.LastSeen = nullTimePtr(last)
			row.Tags = parseTagsJSON(tagsJSON)
			_ = json.Unmarshal([]byte(knownMACsJSON), &row.KnownMACs)
			row.Tags = inventoryDeviceTags(&row)
			if !inventoryTagsMatch(row.Tags, filters.Tags) {
				continue
			}
			devices = append(devices, row)
			if len(devices) >= filters.Limit {
				break
			}
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			return nil, err
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
		if pageRows < filters.Limit {
			break
		}
	}
	return devices, nil
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
		Active: device.Active, Tags: device.Tags,
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
	return normalizeLowerList(tags)
}

func inventoryTagsMatch(actual, required []string) bool {
	for _, tag := range required {
		if !containsFold(actual, tag) {
			return false
		}
	}
	return true
}

func normalizeInventoryFilters(filters InventoryFilters) (InventoryFilters, error) {
	filters.Scope = strings.TrimSpace(filters.Scope)
	if filters.Scope != "" && filters.Scope != "all" {
		return filters, fmt.Errorf("unsupported scope %q", filters.Scope)
	}
	if filters.Scope == "" && filters.PageCursor != "" {
		return filters, fmt.Errorf("page_cursor requires scope all")
	}
	if filters.Scope == "all" {
		filters.PageSize = normalizePageSize(filters.PageSize)
	}
	if filters.Grouping == "" {
		filters.Grouping = InventoryGroupingRegistry
	}
	switch filters.Grouping {
	case InventoryGroupingRegistry, InventoryGroupingCMDB, InventoryGroupingSimilarity:
	default:
		return filters, fmt.Errorf("unsupported inventory grouping %q", filters.Grouping)
	}
	if filters.Limit <= 0 {
		filters.Limit = inventoryDefaultLimit
	}
	if filters.Limit > inventoryMaxLimit {
		filters.Limit = inventoryMaxLimit
	}
	if filters.MinDedupConfidence != nil {
		value := *filters.MinDedupConfidence
		if value < 0 {
			value = 0
		}
		if value > 1 {
			value = 1
		}
		filters.MinDedupConfidence = &value
	}
	filters.LocationIDs = normalizeGraphList(filters.LocationIDs)
	filters.OwnerIDs = normalizeGraphList(filters.OwnerIDs)
	filters.Tags = normalizeLowerList(filters.Tags)
	return filters, nil
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
	defer tx.Rollback()

	where, args := inventoryPageWhere(filters, "d")
	var totalDevices, totalRegistered int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM atheros_search.devices d WHERE `+where, args...).Scan(&totalDevices); err != nil {
		return nil, err
	}
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM atheros_search.devices WHERE registered").Scan(&totalRegistered); err != nil {
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
		row.FirstRegistered = nullTimePtr(first)
		row.LastSeen = nullTimePtr(last)
		row.Tags = parseTagsJSON(tagsJSON)
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

func inventoryPageWhere(filters InventoryFilters, alias string) (string, []any) {
	clauses := []string{"1 = 1"}
	args := []any{}
	addInClause(&clauses, &args, alias+".location_id", stringsToAny(filters.LocationIDs))
	addInClause(&clauses, &args, alias+".owner_id", stringsToAny(filters.OwnerIDs))
	if filters.ActiveOnly {
		clauses = append(clauses, alias+".active")
	}
	for _, tag := range filters.Tags {
		switch {
		case tag == "device":
		case tag == "registered":
			clauses = append(clauses, alias+".registered")
		case tag == "active":
			clauses = append(clauses, alias+".active")
		case strings.HasPrefix(tag, "owner:"):
			clauses = append(clauses, fmt.Sprintf("lower(COALESCE(%s.owner_id, '')) = $%d", alias, len(args)+1))
			args = append(args, strings.TrimPrefix(tag, "owner:"))
		case strings.HasPrefix(tag, "location:"):
			clauses = append(clauses, fmt.Sprintf("lower(COALESCE(%s.location_id, '')) = $%d", alias, len(args)+1))
			args = append(args, strings.TrimPrefix(tag, "location:"))
		default:
			clauses = append(clauses, fmt.Sprintf("EXISTS (SELECT 1 FROM jsonb_array_elements_text(%s.tags) AS stored_tag(value) WHERE lower(stored_tag.value) = $%d)", alias, len(args)+1))
			args = append(args, tag)
		}
	}
	return strings.Join(clauses, " AND "), args
}

func inventoryPageTotals(ctx context.Context, tx *sql.Tx, filters InventoryFilters, where string, args []any, totalDevices int) (int, int, error) {
	switch filters.Grouping {
	case InventoryGroupingRegistry:
		return totalDevices, 0, nil
	case InventoryGroupingCMDB:
		var owners, locations, ownerEdges, locationEdges int
		err := tx.QueryRowContext(ctx, `
SELECT COUNT(DISTINCT NULLIF(d.owner_id, '')), COUNT(DISTINCT NULLIF(d.location_id, '')),
       COUNT(*) FILTER (WHERE COALESCE(d.owner_id, '') <> ''),
       COUNT(*) FILTER (WHERE COALESCE(d.location_id, '') <> '')
FROM atheros_search.devices d WHERE `+where, args...).Scan(&owners, &locations, &ownerEdges, &locationEdges)
		return totalDevices + owners + locations, ownerEdges + locationEdges, err
	case InventoryGroupingSimilarity:
		whereB := strings.ReplaceAll(where, "d.", "db.")
		whereA := strings.ReplaceAll(where, "d.", "da.")
		var candidates int
		err := tx.QueryRowContext(ctx, `
SELECT COUNT(*)
FROM atheros_search.merge_candidates mc
JOIN atheros_search.devices da ON da.mac = mc.mac_a
JOIN atheros_search.devices db ON db.mac = mc.mac_b
WHERE mc.status = 'pending' AND (mc.expires_at IS NULL OR mc.expires_at > CURRENT_TIMESTAMP)
  AND mc.confidence >= $`+fmt.Sprint(len(args)+1)+`
  AND (`+whereA+`) AND (`+whereB+`)`, append(args, minimumInventoryConfidence(filters))...).Scan(&candidates)
		return totalDevices + candidates*2, candidates * 5, err
	default:
		return totalDevices, 0, nil
	}
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
	whereB := strings.ReplaceAll(where, "da.", "db.")
	macs := make([]any, 0, len(devices))
	for _, device := range devices {
		macs = append(macs, device.MAC)
	}
	confidencePlaceholder := len(args) + 1
	args = append(args, minimumInventoryConfidence(filters))
	anchorPlaceholders := pgPlaceholders(len(args)+1, len(macs))
	args = append(args, macs...)
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
	defer rows.Close()
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
		other.FirstRegistered = nullTimePtr(first)
		other.LastSeen = nullTimePtr(last)
		other.Tags = parseTagsJSON(tagsJSON)
		_ = json.Unmarshal([]byte(knownMACsJSON), &other.KnownMACs)
		other.Tags = inventoryDeviceTags(&other)
		addInventoryDevice(nodes, edges, other, InventoryGroupingSimilarity)
		addSimilarityCandidate(nodes, edges, candidate)
	}
	return rows.Err()
}

type pendingInventoryCandidate struct {
	id         string
	macA       string
	macB       string
	confidence float64
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
	nodes[clusterID] = InventoryNode{ID: clusterID, Kind: InventoryNodeCluster, Label: "Similarity " + candidate.id[:minInt(8, len(candidate.id))], Active: true, SimilarityClusterID: candidate.id, Tags: []string{"similarity:pending"}}
	deviceA.SimilarityClusterID = candidate.id
	deviceA.DedupConfidence = &confidence
	nodes[deviceAID] = deviceA
	deviceB.SimilarityClusterID = candidate.id
	deviceB.DedupConfidence = &confidence
	nodes[deviceBID] = deviceB
	edges["merge_candidate:"+candidateID+":"+deviceAID] = InventoryEdge{ID: "merge_candidate:" + candidateID + ":" + deviceAID, Source: candidateID, Target: deviceAID, Kind: InventoryEdgeMergeCandidate, Weight: &confidence}
	edges["merge_candidate:"+candidateID+":"+deviceBID] = InventoryEdge{ID: "merge_candidate:" + candidateID + ":" + deviceBID, Source: candidateID, Target: deviceBID, Kind: InventoryEdgeMergeCandidate, Weight: &confidence}
	edges["same_device:"+deviceAID+":"+deviceBID] = InventoryEdge{ID: "same_device:" + deviceAID + ":" + deviceBID, Source: deviceAID, Target: deviceBID, Kind: InventoryEdgeSameDevice, Weight: &confidence}
	edges["cluster_member:"+clusterID+":"+deviceAID] = InventoryEdge{ID: "cluster_member:" + clusterID + ":" + deviceAID, Source: deviceAID, Target: clusterID, Kind: InventoryEdgeClusterMember, Weight: &confidence}
	edges["cluster_member:"+clusterID+":"+deviceBID] = InventoryEdge{ID: "cluster_member:" + clusterID + ":" + deviceBID, Source: deviceBID, Target: clusterID, Kind: InventoryEdgeClusterMember, Weight: &confidence}
}

func attachSimilarityInventory(ctx context.Context, tx *sql.Tx, nodes map[string]InventoryNode, edges map[string]InventoryEdge, filters InventoryFilters) error {
	minConfidence := 0.0
	if filters.MinDedupConfidence != nil {
		minConfidence = *filters.MinDedupConfidence
	}
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
	defer rows.Close()

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
			Label:               "Similarity " + candidate.id[:minInt(8, len(candidate.id))],
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
		same := "same_device:" + deviceAID + ":" + deviceBID
		edges[same] = InventoryEdge{ID: same, Source: deviceAID, Target: deviceBID, Kind: InventoryEdgeSameDevice, Weight: &confidence}
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
	if len(filters.LocationIDs) > 0 && device.LocationID != "" && !containsFold(filters.LocationIDs, device.LocationID) {
		return false
	}
	if len(filters.OwnerIDs) > 0 && device.OwnerID != "" && !containsFold(filters.OwnerIDs, device.OwnerID) {
		return false
	}
	if !inventoryTagsMatch(device.Tags, filters.Tags) {
		return false
	}
	return true
}

func addInClause(clauses *[]string, args *[]any, column string, values []any) {
	if len(values) == 0 {
		return
	}
	start := len(*args) + 1
	placeholders := pgPlaceholders(start, len(values))
	*clauses = append(*clauses, column+" IN ("+placeholders+")")
	*args = append(*args, values...)
}

func pgPlaceholders(start, count int) string {
	parts := make([]string, count)
	for i := range parts {
		parts[i] = fmt.Sprintf("$%d", start+i)
	}
	return strings.Join(parts, ",")
}

func stringsToAny(values []string) []any {
	out := make([]any, len(values))
	for i, v := range values {
		out[i] = v
	}
	return out
}

func normalizeGraphList(values []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, v := range values {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	sort.Strings(out)
	return out
}

func nullTimePtr(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	utc := value.Time.UTC()
	return &utc
}
