//go:build dbcontract

package assets

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/testdb"
)

func TestDatabaseAnnotationsPreserveRevisionAndAudit(t *testing.T) {
	_, err := testdb.Provision(t).ExecContext(t.Context(), `TRUNCATE atheros_search.asset_annotations, atheros_search.asset_annotation_audit`)
	require.NoError(t, err)
	svc := &Service{Pool: testdb.Runtime(t)}
	label := "Synthetic AP"
	annotation, err := svc.UpdateAssetAnnotation(t.Context(), "ap", "aa:bb:cc:dd:ee:ff", AssetAnnotationUpdate{Label: &label}, "operator")
	require.NoError(t, err)
	require.Equal(t, int64(1), annotation.Revision)
	read, err := svc.AssetAnnotation(t.Context(), "ap", "aa:bb:cc:dd:ee:ff")
	require.NoError(t, err)
	require.Equal(t, "", read.Role)
	require.Equal(t, label, read.Label)
	_, err = svc.UpdateAssetAnnotation(t.Context(), "ap", "aa:bb:cc:dd:ee:ff", AssetAnnotationUpdate{Label: &label}, "operator")
	require.ErrorIs(t, err, ErrAnnotationConflict)
	var count int
	require.NoError(t, svc.Pool.QueryRowContext(t.Context(), `SELECT count(*) FROM atheros_search.asset_annotation_audit`).Scan(&count))
	require.Equal(t, 1, count)
}
