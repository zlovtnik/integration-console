package search

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/apperror"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/db"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/queryscope"
)

const embeddingDimensions = 768

var supportedSearchKinds = map[string]struct{}{
	"event":                     {},
	"device":                    {},
	"proxy_event":               {},
	"proxy_blocked_host_window": {},
	"device_profile":            {},
	"ap_profile":                {},
	"identity_summary":          {},
	"observation_window":        {},
}

func embeddingKindForSourceKind(kind string) string {
	switch kind {
	case "proxy_event", "proxy_blocked_host_window":
		return "event"
	case "device_profile", "ap_profile", "identity_summary":
		return "device"
	case "observation_window":
		return "behaviour"
	default:
		return kind
	}
}

func Dense(ctx context.Context, pool *sql.DB, qvec []float32, model string, opts Options) ([]RawResult, error) {
	if err := validateVector(qvec); err != nil {
		return nil, err
	}
	out := make([]RawResult, 0, opts.TopK*len(opts.Kinds))
	for _, kind := range opts.Kinds {
		results, err := denseKind(ctx, pool, qvec, model, kind, opts)
		if err != nil {
			return nil, err
		}
		out = append(out, results...)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].CosineSimilarity == out[j].CosineSimilarity {
			return out[i].SourceKey < out[j].SourceKey
		}
		return out[i].CosineSimilarity > out[j].CosineSimilarity
	})
	return filterResults(out, opts.Filters, opts.TopK*4), nil
}

func denseKind(ctx context.Context, pool *sql.DB, qvec []float32, model, kind string, opts Options) ([]RawResult, error) {
	if err := db.Require(pool); err != nil {
		return nil, err
	}
	_, ok := supportedSearchKinds[kind]
	if !ok {
		return nil, apperror.Validationf("unsupported dense search kind %q", kind)
	}
	overfetch := opts.TopK * opts.OverfetchFactor
	if overfetch < opts.TopK {
		overfetch = opts.TopK
	}
	if overfetch > 5000 {
		overfetch = 5000
	}
	vector := VectorLiteral(qvec)
	query := denseKindQuery()
	scope, scopeArgs := queryscope.DocumentScopeSQL("candidate", opts.Filters, 6)
	query = strings.Replace(query, "  ORDER BY embedding_row.embedding", scope+"\n  ORDER BY embedding_row.embedding", 1)
	args := append([]any{vector, overfetch, model, embeddingKindForSourceKind(kind), kind}, scopeArgs...)
	rows, err := pool.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }() // Release resources on early return; query, scan, and iteration errors are checked separately.

	results := make([]RawResult, 0, overfetch)
	for rows.Next() {
		result, err := scanDenseResult(rows)
		if err != nil {
			return nil, err
		}
		if result.CosineSimilarity < opts.MinSimilarity || !resultMatchesFilters(result, opts.Filters) {
			continue
		}
		result.Score = result.CosineSimilarity
		results = append(results, result)
		if len(results) >= opts.TopK*4 {
			break
		}
	}
	return results, rows.Err()
}

func denseKindQuery() string {
	return `
SELECT
  d.source_id,
	  d.source_table,
  d.source_kind,
  COALESCE(d.source_mac, ''),
  COALESCE(d.location_id, ''),
  COALESCE(d.sensor_id, ''),
  d.observed_at,
  COALESCE(d.bssid, ''),
  COALESCE(d.ssid, ''),
  COALESCE(d.frame_subtype, ''),
  CAST(1.0 - nearest.cosine_distance AS DOUBLE PRECISION),
  COALESCE(d.filters -> 'tags', '[]'::jsonb)::text,
  COALESCE(d.detail_json::text, '{}'),
  COALESCE(d.security_flags, 0),
	  COALESCE(d.handshake_captured, false),
	  COALESCE(d.host, ''),
	  d.blocked,
	  COALESCE(d.proxy_event_type, ''),
	  COALESCE(CAST(d.proxy_device_id AS TEXT), ''),
	  d.window_start,
	  d.window_end,
	  COALESCE(d.classification, '')
FROM (
  SELECT
    embedding_row.document_id,
    embedding_row.embedding_model,
    embedding_row.embedding OPERATOR(public.<=>) $1::public.vector AS cosine_distance
  FROM atheros_search.embeddings embedding_row
  JOIN atheros_search.search_documents candidate
    ON candidate.document_id = embedding_row.document_id
   AND candidate.source_kind = $5
   AND candidate.status = 'active'
  WHERE embedding_row.embedding_model = $3
    AND embedding_row.embedding_kind = $4
  ORDER BY embedding_row.embedding OPERATOR(public.<=>) $1::public.vector ASC
  LIMIT $2
) nearest
JOIN atheros_search.search_documents d ON d.document_id = nearest.document_id
WHERE d.status = 'active'
  AND d.source_kind = $5
ORDER BY nearest.cosine_distance ASC, d.source_id ASC`
}

func validateVector(vector []float32) error {
	if len(vector) != embeddingDimensions {
		return fmt.Errorf("embedding vector has %d dimensions, expected %d", len(vector), embeddingDimensions)
	}
	for i, value := range vector {
		if math.IsNaN(float64(value)) || math.IsInf(float64(value), 0) {
			return fmt.Errorf("embedding vector contains a non-finite value at index %d", i)
		}
	}
	return nil
}

func normalizeJSONObject(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || value == "null" || !json.Valid([]byte(value)) {
		return "{}"
	}
	return value
}
