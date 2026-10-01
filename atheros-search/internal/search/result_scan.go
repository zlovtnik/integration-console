package search

import (
	"database/sql"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/queryscope"
)

type scanner interface{ Scan(...any) error }

// Dense has one score column; sparse (including wildcard) has two. All other
// columns and their nullable/JSON normalization share the same contract.
func scanResult(row scanner, sparse bool) (RawResult, error) {
	var result RawResult
	var observed, windowStart, windowEnd sql.NullTime
	var blocked sql.NullBool
	var tagsJSON, detailJSON string
	destinations := []any{
		&result.SourceKey, &result.SourceTable, &result.SourceKind, &result.SourceMAC,
		&result.LocationID, &result.SensorID, &observed, &result.BSSID,
		&result.SSID, &result.FrameSubtype, &result.CosineSimilarity,
	}
	if sparse {
		destinations = append(destinations, &result.KeywordRank)
	}
	destinations = append(destinations, &tagsJSON, &detailJSON, &result.securityFlags,
		&result.handshakeCaptured, &result.Host, &blocked, &result.ProxyEventType,
		&result.ProxyDeviceID, &windowStart, &windowEnd, &result.Classification)
	if err := row.Scan(destinations...); err != nil {
		return result, err
	}
	result.ObservedAt = queryscope.NullTimePtr(observed)
	result.WindowStart = queryscope.NullTimePtr(windowStart)
	result.WindowEnd = queryscope.NullTimePtr(windowEnd)
	if blocked.Valid {
		result.Blocked = &blocked.Bool
	}
	result.Tags = queryscope.ParseTagsJSON(tagsJSON)
	result.DetailJSON = normalizeJSONObject(detailJSON)
	return result, nil
}

func scanDenseResult(row scanner) (RawResult, error)  { return scanResult(row, false) }
func scanSparseResult(row scanner) (RawResult, error) { return scanResult(row, true) }
