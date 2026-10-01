package search

import (
	"strings"
	"time"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/queryscope"
	searchv1 "github.com/zlovtnik/ssl-proxy/services/atheros-search/proto/atheros/search/v1"
)

func resultMatchesFilters(result RawResult, filters *searchv1.SearchFilters) bool {
	if filters == nil {
		return true
	}
	if filters.Bssid != "" && !strings.EqualFold(result.BSSID, strings.TrimSpace(filters.Bssid)) {
		return false
	}
	if filters.ObservedApContextOnly && (result.ObservedAt == nil || !queryscope.MacPattern.MatchString(result.SourceMAC) || !queryscope.MacPattern.MatchString(result.BSSID) || result.SourceMAC == result.BSSID || result.SourceMAC == "ff:ff:ff:ff:ff:ff" || result.SourceMAC == "00:00:00:00:00:00" || result.BSSID == "ff:ff:ff:ff:ff:ff" || result.BSSID == "00:00:00:00:00:00") {
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
	if sourceMACs := queryscope.FilterSourceMACs(filters); len(sourceMACs) > 0 && !queryscope.ContainsFold(sourceMACs, result.SourceMAC) {
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
	for _, required := range queryscope.NormalizeLowerList(filters.Tags) {
		if !queryscope.ContainsFold(result.Tags, required) {
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
	return queryscope.ContainsFold(allowed, value)
}

func TimePtr(t time.Time, ok bool) *time.Time {
	if !ok {
		return nil
	}
	return &t
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
