package search

import (
	"context"
	"database/sql"
	"errors"
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
	document, err := s.resolveDocument(ctx, req.SourceKey, kinds, req.Filters)
	details := &ExplainDetails{
		SourceKey:    req.SourceKey,
		BoostReasons: []string{},
	}
	if err != nil {
		return nil, err
	}
	if document == nil {
		return details, nil
	}
	record := document.Fields
	details.Found = true
	details.SourceKind = record.SourceKind
	details.DetailJSON = record.DetailJSON
	details.SequenceTokens = record.SequenceTokens
	details.Record = &record
	if !hasMeaningfulSearchTerms(req.Query) {
		return details, nil
	}
	// The rank is read by document_id so it cannot drift onto a different row
	// than the one the record fields above were taken from.
	args := []any{document.DocumentID, req.Query}
	var sparse float32
	err = s.Pool.QueryRowContext(ctx, `SELECT COALESCE(ts_rank_cd(d.search_vector, websearch_to_tsquery('simple', $2)),0)
FROM atheros_search.search_documents d WHERE d.document_id=$1`, args...).Scan(&sparse)
	if errors.Is(err, sql.ErrNoRows) {
		return details, nil
	}
	if err != nil {
		return nil, err
	}
	details.RankingMethod = "scoped_sparse_direct"
	details.SparseScore = sparse
	details.ScoresAvailable = true
	return details, nil
}
