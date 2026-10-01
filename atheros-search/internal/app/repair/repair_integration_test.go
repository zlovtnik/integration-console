//go:build dbcontract

package repair

import (
	"strings"
	"testing"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/testdb"
)

func TestDatabaseSupersededRepairLeavesActiveJobsAndHonorsDryRun(t *testing.T) {
	provision, runtimeDB := testdb.Provision(t), testdb.Runtime(t)
	_, err := provision.ExecContext(t.Context(), `TRUNCATE atheros_search.search_documents, atheros_search.embedding_jobs CASCADE`)
	require.NoError(t, err)
	for _, item := range []struct{ id, status string }{
		{"00000000-0000-0000-0000-000000000001", "superseded"},
		{"00000000-0000-0000-0000-000000000002", "active"},
	} {
		_, err = provision.ExecContext(t.Context(), `INSERT INTO atheros_search.search_documents(document_id,source_id,source_key,source_kind,source_table,normalized_text,normalized_sha256,status) VALUES($1::uuid,$1::text,$1::text,'event','wireless_frames','synthetic',$2,$3)`, item.id, strings.Repeat("a", 64), item.status)
		require.NoError(t, err)
		_, err = provision.ExecContext(t.Context(), `INSERT INTO atheros_search.embedding_jobs(job_id,document_id,embedding_kind,embedding_model,content_sha256) VALUES($1,$1,'event','contract',$2)`, item.id, strings.Repeat("a", 64))
		require.NoError(t, err)
	}
	require.NoError(t, cancelSupersededJobs(t.Context(), runtimeDB, zerolog.Nop(), 1, true))
	var count int
	require.NoError(t, runtimeDB.QueryRowContext(t.Context(), `SELECT count(*) FROM atheros_search.embedding_jobs WHERE status='pending'`).Scan(&count))
	require.Equal(t, 2, count)
	require.NoError(t, cancelSupersededJobs(t.Context(), runtimeDB, zerolog.Nop(), 1, false))
	var status string
	require.NoError(t, runtimeDB.QueryRowContext(t.Context(), `SELECT status FROM atheros_search.embedding_jobs WHERE job_id='00000000-0000-0000-0000-000000000001'`).Scan(&status))
	require.Equal(t, "cancelled", status)
	require.NoError(t, runtimeDB.QueryRowContext(t.Context(), `SELECT count(*) FROM atheros_search.embedding_jobs WHERE status='pending'`).Scan(&count))
	require.Equal(t, 1, count)
}
