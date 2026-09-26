package search

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDenseKindQueryScopesSharedEmbeddingsBySourceKind(t *testing.T) {
	query := denseKindQuery()
	innerStart := strings.Index(query, "FROM atheros_search.embeddings")
	innerEnd := strings.Index(query, ") nearest")
	require.Greater(t, innerStart, -1)
	require.Greater(t, innerEnd, innerStart)
	inner := query[innerStart:innerEnd]
	require.Contains(t, query, "embedding_row.embedding OPERATOR(public.<=>) $1::public.vector AS cosine_distance")
	require.Contains(t, inner, "ORDER BY embedding_row.embedding OPERATOR(public.<=>) $1::public.vector ASC")
	require.NotContains(t, inner, "embedding_row.embedding <=>")
	require.Contains(t, inner, "LIMIT $2")
	require.Contains(t, inner, "embedding_model = $3")
	require.Contains(t, inner, "embedding_kind = $4")
	require.Contains(t, inner, "candidate.source_kind = $5")
	require.Contains(t, query, "JOIN atheros_search.search_documents")
	require.Contains(t, query, "d.status = 'active'")
	require.Contains(t, query, "d.source_kind = $5")
	require.Contains(t, strings.ToLower(query), "::public.vector")
}

func TestProxyKindsReuseEventEmbeddings(t *testing.T) {
	require.Equal(t, "event", embeddingKindForSourceKind("proxy_event"))
	require.Equal(t, "event", embeddingKindForSourceKind("proxy_blocked_host_window"))
	require.Equal(t, "device", embeddingKindForSourceKind("device"))
}

func TestDenseRejectsUninitializedPool(t *testing.T) {
	_, err := Dense(context.Background(), nil, make([]float32, embeddingDimensions), "model", Options{TopK: 1, Kinds: []string{"event"}})
	require.EqualError(t, err, "Postgres pool is not initialized")
}
