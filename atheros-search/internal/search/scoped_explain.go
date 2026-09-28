package search

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	searchv1 "github.com/zlovtnik/ssl-proxy/services/atheros-search/proto/atheros/search/v1"
)

type ScopedExplainRequest struct {
	SourceKey string                  `json:"source_key"`
	Query     string                  `json:"query"`
	Kind      searchv1.SearchKind     `json:"-"`
	Filters   *searchv1.SearchFilters `json:"-"`
}

// ExplainScoped reads the selected document directly. It deliberately avoids a
// top-K Search rerun, which could omit a valid selected record before its score
// was calculated. The sparse rank is computed in the supplied scope; dense and
// fusion ranks stay unavailable unless they came from the original response.
func (s *Service) ExplainScoped(ctx context.Context, req ScopedExplainRequest) (*ExplainDetails, error) {
	req.SourceKey = strings.TrimSpace(req.SourceKey)
	if req.SourceKey == "" {
		return nil, errors.New("source_key is required")
	}
	kinds, err := requestKinds(req.Kind)
	if err != nil {
		return nil, err
	}
	args := []any{req.SourceKey}
	for _, kind := range kinds {
		args = append(args, kind)
	}
	placeholders := pgPlaceholders(2, len(kinds))
	scope, scopeArgs := documentScopeSQL("d", req.Filters, len(args)+1)
	args = append(args, scopeArgs...)
	details := &ExplainDetails{SourceKey: req.SourceKey, BoostReasons: []string{}}
	if !hasMeaningfulSearchTerms(req.Query) {
		var sourceKind string
		err := s.Pool.QueryRowContext(ctx, `SELECT source_kind FROM atheros_search.search_documents d WHERE d.source_id=$1 AND d.source_kind IN (`+placeholders+") AND d.status='active'"+scope+" ORDER BY d.source_kind LIMIT 1", args...).Scan(&sourceKind)
		if errors.Is(err, sql.ErrNoRows) {
			return details, nil
		}
		if err != nil {
			return nil, err
		}
		details.Found, details.SourceKind = true, sourceKind
		return details, nil
	}
	args = append(args, req.Query)
	queryParam := fmt.Sprintf("$%d", len(args))
	var sourceKind string
	var sparse float32
	err = s.Pool.QueryRowContext(ctx, `SELECT d.source_kind,
COALESCE(ts_rank_cd(d.search_vector, websearch_to_tsquery('simple', `+queryParam+`)),0)
FROM atheros_search.search_documents d
WHERE d.source_id=$1 AND d.source_kind IN (`+placeholders+") AND d.status='active'"+scope+" ORDER BY d.source_kind LIMIT 1", args...).Scan(&sourceKind, &sparse)
	if errors.Is(err, sql.ErrNoRows) {
		return details, nil
	}
	if err != nil {
		return nil, err
	}
	details.Found = true
	details.SourceKind = sourceKind
	details.RankingMethod = "scoped_sparse_direct"
	details.SparseScore = sparse
	details.ScoresAvailable = true
	return details, nil
}
