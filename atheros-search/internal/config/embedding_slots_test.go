package config

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestLoadDefaultsEmbeddingSlotReservation(t *testing.T) {
	setRequiredPostgresEnv(t)
	t.Setenv("ATHSEARCH_EMBEDDING_REQUEST_CONCURRENCY", "")
	t.Setenv("ATHSEARCH_EMBEDDING_QUERY_RESERVED_SLOTS", "")

	cfg, err := Load()
	require.NoError(t, err)
	require.Equal(t, 4, cfg.EmbeddingRequestConcurrency)
	require.Equal(t, 1, cfg.EmbeddingQueryReservedSlots)
}

func TestLoadRejectsReservationsThatStarveInteractiveQueries(t *testing.T) {
	setRequiredPostgresEnv(t)
	t.Setenv("ATHSEARCH_EMBEDDING_REQUEST_CONCURRENCY", "4")
	t.Setenv("ATHSEARCH_EMBEDDING_QUERY_RESERVED_SLOTS", "4")

	_, err := Load()
	require.Error(t, err)
	require.Contains(t, err.Error(), "ATHSEARCH_EMBEDDING_QUERY_RESERVED_SLOTS must be smaller")
}

func TestLoadRejectsNegativeReservations(t *testing.T) {
	setRequiredPostgresEnv(t)
	t.Setenv("ATHSEARCH_EMBEDDING_QUERY_RESERVED_SLOTS", "-1")

	_, err := Load()
	require.Error(t, err)
	require.Contains(t, err.Error(), "must not be negative")
}
