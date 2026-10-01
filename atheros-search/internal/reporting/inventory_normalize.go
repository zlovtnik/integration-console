package reporting

import (
	"strings"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/apperror"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/queryscope"
)

func normalizeInventoryFilters(filters InventoryFilters) (InventoryFilters, error) {
	filters.Scope = strings.TrimSpace(filters.Scope)
	if filters.Scope != "" && filters.Scope != "all" && filters.Scope != "page" {
		return filters, apperror.Validationf("unsupported scope %q", filters.Scope)
	}
	if filters.Scope == "" && filters.PageCursor != "" {
		return filters, apperror.Validationf("page_cursor requires scope all")
	}
	if filters.Scope == "all" || filters.Scope == "page" {
		if filters.Scope == "page" && filters.PageSize <= 0 {
			filters.PageSize = 50
		}
		filters.PageSize = normalizePageSize(filters.PageSize)
	}
	filters.Query = strings.TrimSpace(filters.Query)
	filters.SourceMACs = queryscope.NormalizeLowerList(filters.SourceMACs)
	filters.SensorIDs = queryscope.NormalizeGraphList(filters.SensorIDs)
	if filters.ObservedAfter != nil && filters.ObservedBefore != nil && !filters.ObservedAfter.Before(*filters.ObservedBefore) {
		return filters, apperror.Validationf("observed_after must be before observed_before")
	}
	if filters.Sort == "" {
		filters.Sort = "last_observed"
	}
	if filters.Sort != "last_observed" && filters.Sort != "identifier" {
		return filters, apperror.Validationf("unsupported inventory sort")
	}
	if filters.Grouping == "" {
		filters.Grouping = InventoryGroupingRegistry
	}
	switch filters.Grouping {
	case InventoryGroupingRegistry, InventoryGroupingCMDB, InventoryGroupingSimilarity:
	default:
		return filters, apperror.Validationf("unsupported inventory grouping %q", filters.Grouping)
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
	filters.LocationIDs = queryscope.NormalizeGraphList(filters.LocationIDs)
	filters.OwnerIDs = queryscope.NormalizeGraphList(filters.OwnerIDs)
	filters.Tags = queryscope.NormalizeLowerList(filters.Tags)
	return filters, nil
}
