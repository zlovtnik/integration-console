package search

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestNormalizeSavedViewName(t *testing.T) {
	t.Parallel()

	name, err := normalizeSavedViewName("  Nightly AP view  ")
	require.NoError(t, err)
	require.Equal(t, "Nightly AP view", name)

	_, err = normalizeSavedViewName("   ")
	require.ErrorContains(t, err, "invalid saved view name")

	_, err = normalizeSavedViewName(strings.Repeat("a", 81))
	require.ErrorContains(t, err, "invalid saved view name")

	name, err = normalizeSavedViewName(strings.Repeat("a", 80))
	require.NoError(t, err)
	require.Len(t, name, 80)
}

func TestNormalizeSavedViewSurface(t *testing.T) {
	t.Parallel()

	surface, err := normalizeSavedViewSurface("  ")
	require.NoError(t, err)
	require.Equal(t, SavedViewSurfaceGraphProjection, surface)

	surface, err = normalizeSavedViewSurface("graph_projection")
	require.NoError(t, err)
	require.Equal(t, SavedViewSurfaceGraphProjection, surface)

	_, err = normalizeSavedViewSurface("other_surface")
	require.ErrorContains(t, err, "unsupported saved view surface")
}

func TestNormalizeSavedViewStateRejectsUnknownKinds(t *testing.T) {
	t.Parallel()

	state := SavedViewState{
		GraphFilters:     GraphFilters{Limit: 50},
		VisibleNodeKinds: []string{"device", "wat"},
	}
	_, err := normalizeSavedViewState(state)
	require.ErrorContains(t, err, "invalid saved view state")

	state = SavedViewState{
		GraphFilters:     GraphFilters{Limit: 50},
		VisibleEdgeKinds: []string{"association", "imaginary"},
	}
	_, err = normalizeSavedViewState(state)
	require.ErrorContains(t, err, "invalid saved view state")
}

func TestNormalizeSavedViewStateStripsPagingAndNormalizesFilters(t *testing.T) {
	t.Parallel()

	observedAfter := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	state := SavedViewState{
		GraphFilters: GraphFilters{
			LocationIDs:   []string{" loc-1 ", "", "loc-1"},
			Limit:         5000,
			Hops:          9,
			Scope:         "all",
			PageCursor:    "stale-cursor",
			PageSize:      42,
			ObservedAfter: &observedAfter,
		},
		VisibleNodeKinds: []string{"ap", "ap", "device"},
		VisibleEdgeKinds: []string{"association"},
	}

	normalized, err := normalizeSavedViewState(state)
	require.NoError(t, err)
	require.Empty(t, normalized.GraphFilters.PageCursor)
	require.Equal(t, 0, normalized.GraphFilters.PageSize)
	require.Equal(t, graphMaxLimit, normalized.GraphFilters.Limit)
	require.Equal(t, graphMaxHops, normalized.GraphFilters.Hops)
	require.Equal(t, []string{"loc-1"}, normalized.GraphFilters.LocationIDs)
	require.Equal(t, []string{"ap", "device"}, normalized.VisibleNodeKinds)
}

func TestSavedViewsRequireStableOwner(t *testing.T) {
	t.Parallel()

	require.ErrorIs(t, requireSavedViewOwner(""), ErrSavedViewUnavailable)
	require.ErrorIs(t, requireSavedViewOwner("   "), ErrSavedViewUnavailable)
	require.NoError(t, requireSavedViewOwner("subject-1"))
}

func TestListSavedViewsScopesByOwnerAndSurface(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()

	state := []byte(`{"filters":{"limit":200}}`)
	rows := sqlmock.NewRows([]string{"id", "name", "surface", "view_version", "revision", "state", "created_at", "updated_at"}).
		AddRow("2f6b6a3a-1f2c-4c8a-9a2b-0f5f9f9f9f9f", "Nightly", "graph_projection", 1, 2, state,
			time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC))
	mock.ExpectQuery("ORDER BY lower").WithArgs("subject-1", "graph_projection").WillReturnRows(rows)

	service := &Service{Pool: database}
	views, err := service.ListSavedViews(context.Background(), "subject-1", "")
	require.NoError(t, err)
	require.Len(t, views, 1)
	require.Equal(t, "Nightly", views[0].Name)
	require.Equal(t, int64(2), views[0].Revision)
	require.Equal(t, 200, views[0].State.GraphFilters.Limit)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestListSavedViewsRejectsUnknownSurfaceAndMissingOwner(t *testing.T) {
	t.Parallel()

	service := &Service{}
	_, err := service.ListSavedViews(context.Background(), "subject-1", "inventory")
	require.ErrorContains(t, err, "unsupported saved view surface")
	_, err = service.ListSavedViews(context.Background(), "", "")
	require.ErrorIs(t, err, ErrSavedViewUnavailable)
}

func TestCreateSavedViewEnforcesPerUserLimit(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()

	mock.ExpectBegin()
	mock.ExpectExec("pg_advisory_xact_lock").WithArgs("subject-1", "graph_projection").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("count").WithArgs("subject-1", "graph_projection").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(SavedViewMaxPerUser))

	service := &Service{Pool: database}
	_, err = service.CreateSavedView(context.Background(), "subject-1", SavedViewCreate{Name: "Nightly"})
	require.ErrorIs(t, err, ErrSavedViewLimitReached)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCreateSavedViewPropagatesLockFailure(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()

	mock.ExpectBegin()
	mock.ExpectExec("pg_advisory_xact_lock").WithArgs("subject-1", "graph_projection").
		WillReturnError(errors.New("canceling statement due to lock timeout"))

	service := &Service{Pool: database}
	_, err = service.CreateSavedView(context.Background(), "subject-1", SavedViewCreate{Name: "Nightly"})
	require.ErrorContains(t, err, "lock saved view limit")
}

func TestCreateSavedViewRejectsDuplicateNameCaseInsensitively(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()

	mock.ExpectBegin()
	mock.ExpectExec("pg_advisory_xact_lock").WithArgs("subject-1", "graph_projection").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("count").WithArgs("subject-1", "graph_projection").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery("LIMIT 1").
		WithArgs("subject-1", "graph_projection", "Nightly", nil).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("2f6b6a3a-1f2c-4c8a-9a2b-0f5f9f9f9f9f"))

	service := &Service{Pool: database}
	_, err = service.CreateSavedView(context.Background(), "subject-1", SavedViewCreate{Name: "Nightly"})
	require.ErrorIs(t, err, ErrSavedViewDuplicateName)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestUpdateSavedViewRevisionAndOwnership(t *testing.T) {
	fixtureID := "2f6b6a3a-1f2c-4c8a-9a2b-0f5f9f9f9f9f"

	t.Run("stale revision", func(t *testing.T) {
		database, mock, err := sqlmock.New()
		require.NoError(t, err)
		defer database.Close()

		mock.ExpectBegin()
		mock.ExpectQuery("FOR UPDATE").
			WithArgs(fixtureID, "subject-1").
			WillReturnRows(sqlmock.NewRows([]string{"name", "revision"}).AddRow("Nightly", 3))

		service := &Service{Pool: database}
		_, err = service.UpdateSavedView(context.Background(), "subject-1", fixtureID, SavedViewUpdate{
			Name:             "Nightly",
			ExpectedRevision: 4,
		})
		require.ErrorIs(t, err, ErrSavedViewStaleRevision)
		require.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("foreign or absent id is not found", func(t *testing.T) {
		database, mock, err := sqlmock.New()
		require.NoError(t, err)
		defer database.Close()

		mock.ExpectBegin()
		mock.ExpectQuery("FOR UPDATE").
			WithArgs(fixtureID, "subject-other").
			WillReturnError(sql.ErrNoRows)

		service := &Service{Pool: database}
		_, err = service.UpdateSavedView(context.Background(), "subject-other", fixtureID, SavedViewUpdate{
			Name:             "Nightly",
			ExpectedRevision: 1,
		})
		require.ErrorIs(t, err, ErrSavedViewNotFound)
		require.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("invalid id shape is not found without touching the database", func(t *testing.T) {
		service := &Service{}
		_, err := service.UpdateSavedView(context.Background(), "subject-1", "not-a-uuid", SavedViewUpdate{
			Name:             "Nightly",
			ExpectedRevision: 1,
		})
		require.ErrorIs(t, err, ErrSavedViewNotFound)
	})

	t.Run("zero and negative revisions are invalid, not conflicts", func(t *testing.T) {
		service := &Service{}
		for _, revision := range []int64{0, -1} {
			_, err := service.UpdateSavedView(context.Background(), "subject-1", fixtureID, SavedViewUpdate{
				Name:             "Nightly",
				ExpectedRevision: revision,
			})
			require.ErrorContains(t, err, "expected_revision must be at least 1")
			require.NotErrorIs(t, err, ErrSavedViewStaleRevision)
		}
	})
}

func TestDeleteSavedViewMissingRowIsNotFound(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()

	fixtureID := "2f6b6a3a-1f2c-4c8a-9a2b-0f5f9f9f9f9f"
	mock.ExpectExec("DELETE FROM atheros_search.saved_views").
		WithArgs(fixtureID, "subject-other").
		WillReturnResult(sqlmock.NewResult(0, 0))

	service := &Service{Pool: database}
	err = service.DeleteSavedView(context.Background(), "subject-other", fixtureID)
	require.ErrorIs(t, err, ErrSavedViewNotFound)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSavedViewContractShapeStaysStable(t *testing.T) {
	t.Parallel()

	view := SavedGraphView{
		ID:          "2f6b6a3a-1f2c-4c8a-9a2b-0f5f9f9f9f9f",
		Name:        "Nightly",
		Surface:     SavedViewSurfaceGraphProjection,
		ViewVersion: SavedViewVersion,
		Revision:    1,
		State: SavedViewState{
			GraphFilters:     GraphFilters{Limit: 200, Scope: "all"},
			VisibleNodeKinds: []string{"ap"},
			VisibleEdgeKinds: []string{"association"},
		},
		CreatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		UpdatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
	}
	encoded, err := json.Marshal(view)
	require.NoError(t, err)

	var decoded map[string]any
	require.NoError(t, json.Unmarshal(encoded, &decoded))
	require.Equal(t, "graph_projection", decoded["surface"])
	require.EqualValues(t, 1, decoded["view_version"])
	require.EqualValues(t, 1, decoded["revision"])
	require.NotContains(t, decoded, "owner_subject")

	state := decoded["state"].(map[string]any)
	require.Contains(t, state, "filters")
	require.Contains(t, state, "visible_node_kinds")
	require.Contains(t, state, "visible_edge_kinds")
}
