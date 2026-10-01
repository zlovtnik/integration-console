//go:build dbcontract

package db

import (
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/testdb"
)

func TestDatabaseRuntimePrivilegesAndSchemaChecksum(t *testing.T) {
	provision, database := testdb.Provision(t), testdb.Runtime(t)
	var superuser bool
	require.NoError(t, database.QueryRowContext(t.Context(), `SELECT rolsuper FROM pg_roles WHERE rolname=current_user`).Scan(&superuser))
	require.False(t, superuser)
	for _, query := range []string{`CREATE TABLE atheros_search.forbidden(id int)`, `DELETE FROM atheros_search.search_documents`, `SELECT * FROM octopus_core.registered_devices`, `SELECT * FROM octopus_core.work_items`, `UPDATE atheros_search.schema_readiness SET ready=false`} {
		_, err := database.ExecContext(t.Context(), query)
		var pgErr *pgconn.PgError
		require.True(t, errors.As(err, &pgErr), "%s: %v", query, err)
		require.Equal(t, "42501", pgErr.Code, query)
	}
	checksum := os.Getenv("ATHSEARCH_TEST_MANIFEST_SHA256")
	require.Len(t, checksum, 64)
	pool := &Pool{DB: database, expectedManifest: checksum}
	ready, err := pool.SchemaReady(t.Context())
	require.NoError(t, err)
	require.True(t, ready.Ready)
	pool.expectedManifest = strings.Repeat("0", 64)
	ready, err = pool.SchemaReady(t.Context())
	require.NoError(t, err)
	require.False(t, ready.Ready)
	_, err = provision.ExecContext(t.Context(), `UPDATE atheros_search.schema_readiness SET ready=false WHERE domain='atheros_search'`)
	require.NoError(t, err)
	pool.expectedManifest = checksum
	ready, err = pool.SchemaReady(t.Context())
	require.NoError(t, err)
	require.False(t, ready.Ready)
	_, err = provision.ExecContext(t.Context(), `UPDATE atheros_search.schema_readiness SET ready=true WHERE domain='atheros_search'`)
	require.NoError(t, err)
}
