//go:build dbcontract

package search

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/testdb"
)

func TestDatabaseLogQueryPreservesPrivateTypedMetadata(t *testing.T) {
	database := testdb.Runtime(t)
	for _, query := range []string{"synthetic query", "  "} {
		t.Run(query, func(t *testing.T) {
			id, err := LogQuery(context.Background(), database, query, "cross", nil, 20, []string{"synthetic-record"}, " synthetic-session ", 12)
			require.NoError(t, err)
			require.Positive(t, id)

			var queryHash, sessionHash, metadata string
			var resultCount int
			err = database.QueryRowContext(context.Background(), `
SELECT hashed_query_text, session_hash, request_metadata::text, result_count
FROM atheros_search.search_queries WHERE query_id = $1`, id).
				Scan(&queryHash, &sessionHash, &metadata, &resultCount)
			require.NoError(t, err)
			require.Equal(t, sha256Hex(query), queryHash)
			require.Equal(t, sha256Hex("synthetic-session"), sessionHash)
			require.Equal(t, 1, resultCount)
			if query == "  " {
				require.JSONEq(t, `{"has_query":false}`, metadata)
			} else {
				require.JSONEq(t, `{"has_query":true}`, metadata)
			}
		})
	}
}
