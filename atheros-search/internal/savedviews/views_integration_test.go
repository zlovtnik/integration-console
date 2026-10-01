//go:build dbcontract

package savedviews

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/testdb"
)

func TestDatabaseSavedViewOwnershipNamesAndRevisions(t *testing.T) {
	_, err := testdb.Provision(t).ExecContext(t.Context(), `TRUNCATE atheros_search.saved_views`)
	require.NoError(t, err)
	svc := &Service{Pool: testdb.Runtime(t)}
	view, err := svc.CreateSavedView(t.Context(), "subject-a", SavedViewCreate{Name: "Nightly"})
	require.NoError(t, err)
	_, err = svc.CreateSavedView(t.Context(), "subject-a", SavedViewCreate{Name: "NIGHTLY"})
	require.ErrorIs(t, err, ErrSavedViewDuplicateName)
	views, err := svc.ListSavedViews(t.Context(), "subject-b", "")
	require.NoError(t, err)
	require.Empty(t, views)
	err = svc.DeleteSavedView(t.Context(), "subject-b", view.ID)
	require.ErrorIs(t, err, ErrSavedViewNotFound)
	updated, err := svc.UpdateSavedView(t.Context(), "subject-a", view.ID, SavedViewUpdate{Name: "Renamed", ExpectedRevision: view.Revision})
	require.NoError(t, err)
	require.Equal(t, view.Revision+1, updated.Revision)
	_, err = svc.UpdateSavedView(t.Context(), "subject-a", view.ID, SavedViewUpdate{Name: "Old", ExpectedRevision: view.Revision})
	require.ErrorIs(t, err, ErrSavedViewStaleRevision)
	require.NoError(t, svc.DeleteSavedView(t.Context(), "subject-a", view.ID))
}
