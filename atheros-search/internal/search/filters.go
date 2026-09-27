package search

import (
	"fmt"
	"strings"
	"time"

	searchv1 "github.com/zlovtnik/ssl-proxy/services/atheros-search/proto/atheros/search/v1"
)

// documentScopeSQL applies the same predicates as resultMatchesFilters before
// retrieval budgets are consumed. Values are always bound parameters.
func documentScopeSQL(alias string, filters *searchv1.SearchFilters, start int) (string, []any) {
	if filters == nil {
		return "", nil
	}
	clauses := []string{}
	args := []any{}
	bind := func(value any) string { args = append(args, value); return fmt.Sprintf("$%d", start+len(args)-1) }
	list := func(column string, values []string) {
		values = normalizeLowerList(values)
		if len(values) == 0 {
			return
		}
		p := []string{}
		for _, value := range values {
			p = append(p, bind(value))
		}
		clauses = append(clauses, "lower(btrim(COALESCE("+alias+"."+column+", ''))) IN ("+strings.Join(p, ",")+")")
	}
	list("location_id", filters.LocationIds)
	list("sensor_id", filters.SensorIds)
	list("source_mac", filterSourceMACs(filters))
	if filters.Bssid != "" {
		clauses = append(clauses, alias+".bssid = "+bind(strings.ToLower(strings.TrimSpace(filters.Bssid))))
	}
	if filters.ObservedApContextOnly {
		clauses = append(clauses, qualifyingAPSQL(alias))
	}
	if filters.EntityQuery != "" {
		clauses = append(clauses, entityScopeSQL(alias, bind(strings.ToLower(strings.TrimSpace(filters.EntityQuery)))))
	}
	list("frame_subtype", filters.FrameSubtypes)
	list("proxy_event_type", filters.EventTypes)
	list("proxy_device_id::text", filters.ProxyDeviceIds)
	list("classification", filters.Classifications)
	for _, item := range []struct{ column, value string }{{"ssid", filters.Ssid}, {"host", filters.Host}} {
		if value := strings.TrimSpace(item.value); value != "" {
			clauses = append(clauses, "strpos(lower(COALESCE("+alias+"."+item.column+", '')), "+bind(strings.ToLower(value))+") > 0")
		}
	}
	if filters.Blocked != nil {
		clauses = append(clauses, alias+".blocked = "+bind(*filters.Blocked))
	}
	if filters.ObservedAfter != nil {
		clauses = append(clauses, alias+".observed_at >= "+bind(filters.ObservedAfter.AsTime()))
	}
	if filters.ObservedBefore != nil {
		clauses = append(clauses, alias+".observed_at < "+bind(filters.ObservedBefore.AsTime()))
	}
	if filters.SecurityFlagsMask != 0 {
		clauses = append(clauses, "("+alias+".security_flags & "+bind(filters.SecurityFlagsMask)+") <> 0")
	}
	if filters.HandshakeOnly {
		clauses = append(clauses, alias+".handshake_captured")
	}
	if filters.ThreatOnly {
		clauses = append(clauses, "("+alias+".handshake_captured OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE("+alias+".filters -> 'tags', '[]'::jsonb)) t(value) WHERE lower(btrim(t.value)) LIKE 'threat:%'))")
	}
	for _, tag := range normalizeLowerList(filters.Tags) {
		clauses = append(clauses, "EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE("+alias+".filters -> 'tags', '[]'::jsonb)) t(value) WHERE lower(btrim(t.value)) = "+bind(tag)+")")
	}
	if len(clauses) == 0 {
		return "", args
	}
	return " AND " + strings.Join(clauses, " AND "), args
}

func resultMatchesFilters(result RawResult, filters *searchv1.SearchFilters) bool {
	if filters == nil {
		return true
	}
	if filters.Bssid != "" && !strings.EqualFold(result.BSSID, strings.TrimSpace(filters.Bssid)) {
		return false
	}
	if filters.ObservedApContextOnly && (result.ObservedAt == nil || !macPattern.MatchString(result.SourceMAC) || !macPattern.MatchString(result.BSSID) || result.SourceMAC == result.BSSID || result.SourceMAC == "ff:ff:ff:ff:ff:ff" || result.SourceMAC == "00:00:00:00:00:00" || result.BSSID == "ff:ff:ff:ff:ff:ff" || result.BSSID == "00:00:00:00:00:00") {
		return false
	}
	if !matchesFoldList(result.LocationID, filters.LocationIds) ||
		!matchesFoldList(result.SensorID, filters.SensorIds) ||
		!matchesFoldList(result.FrameSubtype, filters.FrameSubtypes) {
		return false
	}
	if ssid := strings.TrimSpace(filters.Ssid); ssid != "" && !strings.Contains(strings.ToLower(result.SSID), strings.ToLower(ssid)) {
		return false
	}
	if sourceMACs := filterSourceMACs(filters); len(sourceMACs) > 0 && !containsFold(sourceMACs, result.SourceMAC) {
		return false
	}
	if host := strings.TrimSpace(filters.Host); host != "" && !strings.Contains(strings.ToLower(result.Host), strings.ToLower(host)) {
		return false
	}
	if filters.Blocked != nil && (result.Blocked == nil || *result.Blocked != *filters.Blocked) {
		return false
	}
	if !matchesFoldList(result.ProxyEventType, filters.EventTypes) ||
		!matchesFoldList(result.ProxyDeviceID, filters.ProxyDeviceIds) ||
		!matchesFoldList(result.Classification, filters.Classifications) {
		return false
	}
	if filters.ObservedAfter != nil && (result.ObservedAt == nil || result.ObservedAt.Before(filters.ObservedAfter.AsTime())) {
		return false
	}
	if filters.ObservedBefore != nil && (result.ObservedAt == nil || !result.ObservedAt.Before(filters.ObservedBefore.AsTime())) {
		return false
	}
	if filters.SecurityFlagsMask != 0 && result.securityFlags&filters.SecurityFlagsMask == 0 {
		return false
	}
	if filters.HandshakeOnly && !result.handshakeCaptured {
		return false
	}
	if filters.ThreatOnly && !result.handshakeCaptured && !hasThreatTag(result.Tags) {
		return false
	}
	for _, required := range normalizeLowerList(filters.Tags) {
		if !containsFold(result.Tags, required) {
			return false
		}
	}
	return true
}

func filterResults(results []RawResult, filters *searchv1.SearchFilters, limit int) []RawResult {
	out := make([]RawResult, 0, minInt(limit, len(results)))
	for _, result := range results {
		if !resultMatchesFilters(result, filters) {
			continue
		}
		out = append(out, result)
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out
}

func hasThreatTag(tags []string) bool {
	for _, tag := range tags {
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(tag)), "threat:") {
			return true
		}
	}
	return false
}

func matchesFoldList(value string, allowed []string) bool {
	if len(allowed) == 0 {
		return true
	}
	return containsFold(allowed, value)
}

func containsFold(values []string, value string) bool {
	value = strings.TrimSpace(value)
	for _, candidate := range values {
		if strings.EqualFold(strings.TrimSpace(candidate), value) {
			return true
		}
	}
	return false
}

func filterSourceMACs(filters *searchv1.SearchFilters) []string {
	if filters == nil {
		return nil
	}
	values := make([]string, 0, 1+len(filters.SourceMacs))
	values = append(values, filters.SourceMac)
	values = append(values, filters.SourceMacs...)
	return normalizeLowerList(values)
}

func normalizeLowerList(values []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func TimePtr(t time.Time, ok bool) *time.Time {
	if !ok {
		return nil
	}
	return &t
}

func escapeLike(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `%`, `\%`)
	value = strings.ReplaceAll(value, `_`, `\_`)
	return value
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
