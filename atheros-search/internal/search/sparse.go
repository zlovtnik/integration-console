package search

import (
	"context"
	"database/sql"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/apperror"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/db"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/queryscope"
)

func Sparse(ctx context.Context, pool *sql.DB, query string, opts Options) ([]RawResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, nil
	}
	if err := db.Require(pool); err != nil {
		return nil, err
	}
	results := make([]RawResult, 0, opts.TopK*len(opts.Kinds))
	for _, kind := range opts.Kinds {
		kindResults, err := sparseKind(ctx, pool, query, kind, opts)
		if err != nil {
			return nil, err
		}
		results = append(results, kindResults...)
	}
	sort.SliceStable(results, func(i, j int) bool {
		if results[i].KeywordRank == results[j].KeywordRank {
			if equalTime(results[i].ObservedAt, results[j].ObservedAt) {
				return results[i].SourceKey < results[j].SourceKey
			}
			return timeAfter(results[i].ObservedAt, results[j].ObservedAt)
		}
		return results[i].KeywordRank > results[j].KeywordRank
	})
	return filterResults(results, opts.Filters, opts.TopK*4), nil
}

func sparseKind(ctx context.Context, pool *sql.DB, query, kind string, opts Options) ([]RawResult, error) {
	if _, ok := supportedSearchKinds[kind]; !ok {
		return nil, apperror.Validationf("unsupported sparse search kind %q", kind)
	}
	overfetch := opts.TopK * opts.OverfetchFactor
	if overfetch < opts.TopK*4 {
		overfetch = opts.TopK * 4
	}
	if overfetch > 5000 {
		overfetch = 5000
	}
	if isWildcardAllSearch(query) {
		return sparseWildcard(ctx, pool, kind, opts, overfetch)
	}
	querySQL := `
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
  CAST(0 AS DOUBLE PRECISION),
  CAST(ts_rank_cd(d.search_vector, websearch_to_tsquery('simple', $1)) AS DOUBLE PRECISION),
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
FROM atheros_search.search_documents d
WHERE d.search_vector @@ websearch_to_tsquery('simple', $1)
  AND d.source_kind = $2
  AND d.status = 'active'
ORDER BY ts_rank_cd(d.search_vector, websearch_to_tsquery('simple', $1)) DESC,
         d.observed_at DESC,
         d.source_id ASC
LIMIT $3`
	scope, args := queryscope.DocumentScopeSQL("d", opts.Filters, 4)
	querySQL = strings.Replace(querySQL, "\nORDER BY", scope+"\nORDER BY", 1)
	return scanSparseRows(ctx, pool, querySQL, opts, append([]any{query, kind, overfetch}, args...)...)
}

func sparseWildcard(ctx context.Context, pool *sql.DB, kind string, opts Options, limit int) ([]RawResult, error) {
	query := `
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
  CAST(0 AS DOUBLE PRECISION),
  CAST(0.1 AS DOUBLE PRECISION),
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
FROM atheros_search.search_documents d
WHERE d.source_kind = $1 AND d.status = 'active'
ORDER BY d.observed_at DESC, d.source_id ASC
LIMIT $2`
	scope, args := queryscope.DocumentScopeSQL("d", opts.Filters, 3)
	query = strings.Replace(query, "\nORDER BY", scope+"\nORDER BY", 1)
	return scanSparseRows(ctx, pool, query, opts, append([]any{kind, limit}, args...)...)
}

func scanSparseRows(ctx context.Context, pool *sql.DB, query string, opts Options, args ...any) ([]RawResult, error) {
	rows, err := pool.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }() // Release resources on early return; query, scan, and iteration errors are checked separately.
	results := make([]RawResult, 0)
	for rows.Next() {
		result, err := scanSparseResult(rows)
		if err != nil {
			return nil, err
		}
		if !resultMatchesFilters(result, opts.Filters) {
			continue
		}
		result.Score = result.KeywordRank
		results = append(results, result)
		if len(results) >= opts.TopK*4 {
			break
		}
	}
	return results, rows.Err()
}

func sparseTokenPatterns(query string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0)
	for _, raw := range strings.Fields(strings.ToLower(query)) {
		var builder strings.Builder
		for _, char := range raw {
			switch {
			case unicode.IsLetter(char), unicode.IsDigit(char), char == '_', char == '-', char == ':':
				builder.WriteRune(char)
			case char == '*', char == '%':
				builder.WriteRune('%')
			}
		}
		pattern := strings.Trim(builder.String(), "%")
		if pattern == "" {
			continue
		}
		if strings.HasSuffix(builder.String(), "%") {
			pattern += "%"
		}
		if _, ok := seen[pattern]; ok {
			continue
		}
		seen[pattern] = struct{}{}
		out = append(out, pattern)
	}
	return out
}

func sparsePattern(query string) string {
	patterns := sparseTokenPatterns(query)
	if len(patterns) == 0 {
		return "%"
	}
	return patterns[0]
}

func equalTime(left, right *time.Time) bool {
	if left == nil || right == nil {
		return left == right
	}
	return left.Equal(*right)
}

func timeAfter(left, right *time.Time) bool {
	if left == nil {
		return false
	}
	if right == nil {
		return true
	}
	return left.After(*right)
}
