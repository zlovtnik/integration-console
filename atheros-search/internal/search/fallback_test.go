package search

import (
	"context"
	"errors"
	"fmt"
	"io"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/config"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/embed"
	searchv1 "github.com/zlovtnik/ssl-proxy/services/atheros-search/proto/atheros/search/v1"
)

func TestUnavailableClassifiesEmbeddingFailuresWithoutLeakingText(t *testing.T) {
	retryAt := time.Now().Add(45 * time.Second)
	for _, test := range []struct {
		name string
		err  error
		code string
	}{
		{
			name: "backend transport failure",
			err:  &embed.BackendUnavailableError{Cause: errors.New("dial tcp: connection refused to llama.example.test:8080")},
			code: FallbackBackendUnavailable,
		},
		{
			name: "capacity exhausted",
			err:  &embed.BackendUnavailableError{RetryAt: retryAt, Cause: embed.ErrCapacityExhausted},
			code: FallbackCapacityExhausted,
		},
		{
			name: "invalid response",
			err:  &embed.BackendUnavailableError{Cause: embed.ErrInvalidResponse},
			code: FallbackInvalidResponse,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			unavailable := Unavailable(test.err)
			require.Equal(t, test.code, unavailable.Code)
			require.NotContains(t, unavailable.Error(), "llama.example.test")
			require.NotContains(t, unavailable.Message, "dial tcp")

			_, message := semanticFallbackCode(test.err)
			require.Equal(t, unavailable.Message, message)
			require.NotContains(t, message, "dial tcp")
		})
	}
}

func TestSearchLegFailurePassesCallerDeadlineAndInvalidRequestsThrough(t *testing.T) {
	expired, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	require.EqualError(t, searchLegFailure(expired, context.DeadlineExceeded), context.DeadlineExceeded.Error())

	invalid := embed.ErrInvalidRequest
	require.ErrorIs(t, searchLegFailure(context.Background(), invalid), embed.ErrInvalidRequest)

	var unavailable *UnavailableError
	require.ErrorAs(t, searchLegFailure(context.Background(), errors.New("dial tcp refused")), &unavailable)
	require.Equal(t, FallbackBackendUnavailable, unavailable.Code)
}

func TestSearchHybridFallsBackWithStableCodeAndRetryHint(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer func() { _ = database.Close() }() // Best-effort test teardown; assertions verify the operation before cleanup.
	mock.ExpectQuery("FROM atheros_search.search_documents").
		WillReturnRows(sqlmock.NewRows([]string{"source_id"}))
	mock.ExpectQuery("INSERT INTO atheros_search.search_queries").
		WillReturnRows(sqlmock.NewRows([]string{"query_id"}).AddRow(1))

	retryAt := time.Now().Add(30 * time.Second).UTC().Truncate(time.Second)
	embedErr := &embed.BackendUnavailableError{
		RetryAt: retryAt,
		Cause:   fmt.Errorf("all 4 slots busy: %w", embed.ErrCapacityExhausted),
	}

	svc := &Service{
		Pool:     database,
		Embedder: failingEmbedder{err: embedErr},
		Config:   config.Config{SearchTimeout: time.Second},
		Logger:   zerolog.New(io.Discard),
	}
	response, err := svc.Search(context.Background(), &searchv1.SearchRequest{
		Query: "wireless", Kind: searchv1.SearchKind_SEARCH_KIND_EVENT, Mode: searchv1.SearchMode_SEARCH_MODE_HYBRID,
	})
	require.NoError(t, err)
	require.Equal(t, searchv1.SearchMode_SEARCH_MODE_SPARSE, response.ModeUsed)
	require.Equal(t, FallbackCapacityExhausted, response.FallbackCode)
	require.Equal(t, "semantic backend capacity exhausted", response.FallbackReason)
	require.NotContains(t, response.FallbackReason, "slots")
	require.NotNil(t, response.FallbackRetryAt)
	require.WithinDuration(t, retryAt, response.FallbackRetryAt.AsTime(), time.Second)
	require.NoError(t, mock.ExpectationsWereMet())
}

type failingEmbedder struct{ err error }

func (f failingEmbedder) Embed(context.Context, []string, embed.Kind) ([][]float32, error) {
	return nil, f.err
}

func (f failingEmbedder) Health(context.Context) error { return f.err }
