package search

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/require"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/config"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/embed"
	athmetrics "github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/metrics"
	searchv1 "github.com/zlovtnik/ssl-proxy/services/atheros-search/proto/atheros/search/v1"
)

type emptyEmbedder struct{}

func (emptyEmbedder) Embed(context.Context, []string, embed.Kind) ([][]float32, error) {
	return nil, nil
}
func (emptyEmbedder) Health(context.Context) error { return nil }

func TestSearchRejectsEmptyQuery(t *testing.T) {
	registry := prometheus.NewRegistry()
	svc := &Service{Metrics: athmetrics.NewForRegisterer(registry)}
	_, err := svc.Search(context.Background(), &searchv1.SearchRequest{
		Query: "", Kind: searchv1.SearchKind_SEARCH_KIND_CROSS, Mode: searchv1.SearchMode_SEARCH_MODE_SPARSE,
	})
	require.EqualError(t, err, "search query is required and must contain meaningful terms")

	families, gatherErr := registry.Gather()
	require.NoError(t, gatherErr)
	var errorCount float64
	for _, family := range families {
		if family.GetName() != "athsearch_search_requests_total" {
			continue
		}
		for _, metric := range family.Metric {
			labels := make(map[string]string, len(metric.Label))
			for _, label := range metric.Label {
				labels[label.GetName()] = label.GetValue()
			}
			if labels["kind"] == "cross" && labels["mode"] == "sparse" && labels["status"] == "error" {
				errorCount = metric.GetCounter().GetValue()
			}
		}
	}
	require.Equal(t, float64(1), errorCount)
}

func TestSearchRejectsEmptyDenseEmbeddingResult(t *testing.T) {
	svc := &Service{
		Embedder: emptyEmbedder{},
		Config:   config.Config{SearchTimeout: time.Second},
	}
	_, err := svc.Search(context.Background(), &searchv1.SearchRequest{
		Query: "wireless", Kind: searchv1.SearchKind_SEARCH_KIND_EVENT, Mode: searchv1.SearchMode_SEARCH_MODE_DENSE,
	})
	require.EqualError(t, err, "embedding backend returned no vectors")
}

func TestSearchFallsBackToSparseForEmptyEmbeddingResult(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()
	mock.ExpectQuery("FROM atheros_search.search_documents").
		WillReturnRows(sqlmock.NewRows([]string{"source_id"}))
	mock.ExpectQuery("INSERT INTO atheros_search.search_queries").
		WillReturnRows(sqlmock.NewRows([]string{"query_id"}).AddRow(1))

	svc := &Service{
		Pool:     database,
		Embedder: emptyEmbedder{},
		Config:   config.Config{SearchTimeout: time.Second},
	}
	response, err := svc.Search(context.Background(), &searchv1.SearchRequest{
		Query: "wireless", Kind: searchv1.SearchKind_SEARCH_KIND_EVENT, Mode: searchv1.SearchMode_SEARCH_MODE_HYBRID,
	})
	require.NoError(t, err)
	require.Equal(t, searchv1.SearchMode_SEARCH_MODE_SPARSE, response.ModeUsed)
	require.Equal(t, "embedding backend returned no vectors", response.FallbackReason)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHasMeaningfulSearchTerms(t *testing.T) {
	for _, test := range []struct {
		query string
		want  bool
	}{
		{"", false}, {"   ", false}, {"*", false}, {"%", false}, {" * % * ", false},
		{"* foo *", true}, {"foo*bar", true},
	} {
		require.Equal(t, test.want, hasMeaningfulSearchTerms(test.query), test.query)
	}
}

func TestIsWildcardAllSearch(t *testing.T) {
	for _, query := range []string{"*", "%", " * % * "} {
		require.True(t, isWildcardAllSearch(query), query)
		require.Equal(t, "%", sparsePattern(query))
	}
	for _, query := range []string{"", "foo*", "* foo *"} {
		require.False(t, isWildcardAllSearch(query), query)
	}
}

func TestSparseTokenPatternsNormalizeAndPreserveSuffixWildcard(t *testing.T) {
	require.Equal(t, []string{"deauth%", "probe_request", "threat:rogue"}, sparseTokenPatterns("Deauth* probe_request threat:rogue"))
	require.Equal(t, []string{"deauth"}, sparseTokenPatterns("deauth deauth"))
}

func TestSuggestSSIDQueryIsPostgreSQLSafe(t *testing.T) {
	require.Contains(t, suggestSSIDSQL, "LIMIT 50")
	require.Contains(t, suggestSSIDSQL, "$1")
}
