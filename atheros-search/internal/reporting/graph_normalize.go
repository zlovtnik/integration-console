package reporting

import (
	"strings"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/apperror"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/queryscope"
)

func NormalizeGraphFilters(filters GraphFilters) (GraphFilters, error) {
	filters.RootBSSID = strings.ToLower(strings.TrimSpace(filters.RootBSSID))
	filters.RootNodeID = strings.TrimSpace(filters.RootNodeID)
	if filters.RootBSSID != "" || filters.RootNodeID != "" {
		filters.Hierarchy = true
	}
	if filters.Hierarchy && filters.PageCursor != "" {
		return filters, apperror.Validationf("page_cursor is not supported for hierarchy graphs")
	}
	if filters.Projection != "" && filters.Projection != "legacy" && filters.Projection != "stream" {
		return filters, apperror.Validationf("unsupported graph projection")
	}
	if filters.Projection == "stream" {
		if len(filters.Kinds) == 0 {
			filters.Kinds = []string{"device", "ap", "location", "sensor"}
			if filters.IncludeIdentity {
				filters.Kinds = append(filters.Kinds, "cluster")
			}
		}
		if len(filters.EdgeKinds) == 0 {
			filters.EdgeKinds = []string{"containment", "observed_association", "calibrated_range"}
			if filters.IncludeIdentity {
				filters.EdgeKinds = append(filters.EdgeKinds, "identity_membership")
			}
		}
	}
	filters.Scope = strings.TrimSpace(filters.Scope)
	if filters.Scope != "" && filters.Scope != "all" {
		return filters, apperror.Validationf("unsupported scope %q", filters.Scope)
	}
	if filters.Scope == "" && filters.PageCursor != "" {
		return filters, apperror.Validationf("page_cursor requires scope all")
	}
	if filters.Scope == "all" {
		filters.PageSize = normalizePageSize(filters.PageSize)
	}
	if filters.Limit <= 0 {
		filters.Limit = graphDefaultLimit
		if filters.Hierarchy {
			filters.Limit = GraphMaxLimit
		}
	}
	if filters.Limit > GraphMaxLimit {
		filters.Limit = GraphMaxLimit
	}
	if filters.ObservedAfter != nil && filters.ObservedBefore != nil && !filters.ObservedAfter.Before(*filters.ObservedBefore) {
		return filters, apperror.Validationf("observed_after must be before observed_before")
	}
	filters.LocationIDs = queryscope.NormalizeGraphList(filters.LocationIDs)
	filters.SensorIDs = queryscope.NormalizeGraphList(filters.SensorIDs)
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
	if filters.Hops > GraphMaxHops {
		filters.Hops = GraphMaxHops
	}
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

func anchorGraphFilters(filters GraphFilters) GraphFilters {
	anchor := GraphFilters{
		SourceMAC: filters.SourceMAC,
		Limit:     1,
	}
	return anchor
}
