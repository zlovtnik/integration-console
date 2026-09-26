package search

import (
	"context"
	"io"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/rs/zerolog"
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

type staticEmbedder struct{}

func (staticEmbedder) Embed(context.Context, []string, embed.Kind) ([][]float32, error) {
	vector := make([]float32, embeddingDimensions)
	return [][]float32{vector}, nil
}
func (staticEmbedder) Health(context.Context) error { return nil }

func TestSearchReportsMissingKindCoverageWhenDenseIsEmpty(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()

	denseRows := sqlmock.NewRows([]string{
		"source_id", "source_kind", "source_key", "title", "snippet", "source_table",
		"location_id", "sensor_id", "source_mac", "observed_at", "document_text",
		"similarity", "rank",
	})
	mock.ExpectQuery("FROM atheros_search.embeddings").WillReturnRows(denseRows)
	mock.ExpectQuery("SELECT COUNT\\(\\*\\) FROM atheros_search.embeddings").
		WithArgs("device").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectQuery("FROM atheros_search.search_documents").
		WillReturnRows(sqlmock.NewRows([]string{"source_id"}))
	mock.ExpectQuery("INSERT INTO atheros_search.search_queries").
		WillReturnRows(sqlmock.NewRows([]string{"query_id"}).AddRow(1))

	svc := &Service{
		Pool:     database,
		Embedder: staticEmbedder{},
		Config:   config.Config{SearchTimeout: time.Second},
		Logger:   zerolog.New(io.Discard),
	}
	response, err := svc.Search(context.Background(), &searchv1.SearchRequest{
		Query: "lab laptop", Kind: searchv1.SearchKind_SEARCH_KIND_DEVICE, Mode: searchv1.SearchMode_SEARCH_MODE_HYBRID,
	})
	require.NoError(t, err)
	require.Equal(t, searchv1.SearchMode_SEARCH_MODE_SPARSE, response.ModeUsed)
	require.Contains(t, response.FallbackReason, `no embeddings indexed for requested kind(s) "device"`)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSearchKeepsHybridWhenKindHasCoverage(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()

	denseRows := sqlmock.NewRows([]string{
		"source_id", "source_kind", "source_key", "title", "snippet", "source_table",
		"location_id", "sensor_id", "source_mac", "observed_at", "document_text",
		"similarity", "rank",
	})
	mock.ExpectQuery("FROM atheros_search.embeddings").WillReturnRows(denseRows)
	mock.ExpectQuery("SELECT COUNT\\(\\*\\) FROM atheros_search.embeddings").
		WithArgs("device").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(42))
	mock.ExpectQuery("FROM atheros_search.search_documents").
		WillReturnRows(sqlmock.NewRows([]string{"source_id"}))
	mock.ExpectQuery("INSERT INTO atheros_search.search_queries").
		WillReturnRows(sqlmock.NewRows([]string{"query_id"}).AddRow(1))

	svc := &Service{
		Pool:     database,
		Embedder: staticEmbedder{},
		Config:   config.Config{SearchTimeout: time.Second},
		Logger:   zerolog.New(io.Discard),
	}
	response, err := svc.Search(context.Background(), &searchv1.SearchRequest{
		Query: "lab laptop", Kind: searchv1.SearchKind_SEARCH_KIND_DEVICE, Mode: searchv1.SearchMode_SEARCH_MODE_HYBRID,
	})
	require.NoError(t, err)
	require.Equal(t, searchv1.SearchMode_SEARCH_MODE_HYBRID, response.ModeUsed)
	require.Empty(t, response.FallbackReason)
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

func TestProxySearchKindsRouteBySourceKind(t *testing.T) {
	events, err := requestKinds(searchv1.SearchKind_SEARCH_KIND_PROXY_EVENT)
	require.NoError(t, err)
	require.Equal(t, []string{"proxy_event"}, events)

	windows, err := requestKinds(searchv1.SearchKind_SEARCH_KIND_PROXY_BLOCKED_HOST_WINDOW)
	require.NoError(t, err)
	require.Equal(t, []string{"proxy_blocked_host_window"}, windows)
}

func TestProxyResultMetadataIsReturned(t *testing.T) {
	blocked := false
	windowStart := time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC)
	windowEnd := windowStart.Add(time.Hour)
	result := toProtoResult(RawResult{
		SourceKey: "event-id", SourceTable: "proxy_events", SourceKind: "proxy_event",
		Host: "api.example", Blocked: &blocked, ProxyEventType: "http_proxied",
		ProxyDeviceID: "device-id", Classification: "cdn",
		WindowStart: &windowStart, WindowEnd: &windowEnd,
	})

	require.Equal(t, "proxy_events", result.SourceTable)
	require.Equal(t, "api.example", result.Host)
	require.NotNil(t, result.Blocked)
	require.False(t, result.GetBlocked())
	require.Equal(t, "http_proxied", result.ProxyEventType)
	require.Equal(t, windowStart, result.WindowStart.AsTime())
	require.Equal(t, windowEnd, result.WindowEnd.AsTime())
}

func TestExplainDetailsDistinguishesMissingFromUnrankedRecord(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()
	svc := &Service{Pool: database}

	mock.ExpectQuery("SELECT source_kind").
		WithArgs("present-key", "device").
		WillReturnRows(sqlmock.NewRows([]string{"source_kind"}).AddRow("device"))
	present, err := svc.ExplainDetails(context.Background(), &searchv1.ExplainRequest{
		SourceKey: "present-key", Kind: searchv1.SearchKind_SEARCH_KIND_DEVICE,
	})
	require.NoError(t, err)
	require.True(t, present.Found)
	require.False(t, present.ScoresAvailable)
	require.Equal(t, "device", present.SourceKind)

	mock.ExpectQuery("SELECT source_kind").
		WithArgs("missing-key", "device").
		WillReturnRows(sqlmock.NewRows([]string{"source_kind"}))
	missing, err := svc.ExplainDetails(context.Background(), &searchv1.ExplainRequest{
		SourceKey: "missing-key", Kind: searchv1.SearchKind_SEARCH_KIND_DEVICE,
	})
	require.NoError(t, err)
	require.False(t, missing.Found)
	require.False(t, missing.ScoresAvailable)
	require.Empty(t, missing.SourceKind)
	require.NoError(t, mock.ExpectationsWereMet())
}
