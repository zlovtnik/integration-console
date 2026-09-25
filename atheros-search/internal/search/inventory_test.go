package search

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestSimilarityInventoryIncludesPendingMergeCandidate(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()
	mock.ExpectBegin()
	mock.ExpectQuery("FROM atheros_search.merge_candidates").WithArgs(0.0, 400).
		WillReturnRows(sqlmock.NewRows([]string{"candidate_id", "mac_a", "mac_b", "confidence"}).
			AddRow("candidate-1", "aa:bb:cc:dd:ee:01", "aa:bb:cc:dd:ee:02", 0.95))
	mock.ExpectRollback()
	tx, err := database.Begin()
	require.NoError(t, err)
	nodes := map[string]InventoryNode{
		"device:aa:bb:cc:dd:ee:01": {ID: "device:aa:bb:cc:dd:ee:01", Kind: InventoryNodeDevice},
		"device:aa:bb:cc:dd:ee:02": {ID: "device:aa:bb:cc:dd:ee:02", Kind: InventoryNodeDevice},
	}
	edges := map[string]InventoryEdge{}
	err = attachSimilarityInventory(context.Background(), tx, nodes, edges, InventoryFilters{Limit: 400})
	require.NoError(t, err)
	require.Contains(t, nodes, "merge:candidate-1")
	require.Contains(t, nodes, "cluster:candidate-1")
	require.Len(t, edges, 5)
	require.NoError(t, tx.Rollback())
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestNormalizeInventoryFiltersDefaultsAndClamps(t *testing.T) {
	got, err := normalizeInventoryFilters(InventoryFilters{
		Grouping:    InventoryGroupingCMDB,
		LocationIDs: []string{" lab ", "lab", ""},
		OwnerIDs:    []string{" security ", "security"},
		Tags:        []string{" Active ", "active"},
		Limit:       5000,
	})
	require.NoError(t, err)
	require.Equal(t, inventoryMaxLimit, got.Limit)
	require.Equal(t, []string{"lab"}, got.LocationIDs)
	require.Equal(t, []string{"security"}, got.OwnerIDs)
	require.Equal(t, []string{"active"}, got.Tags)
}

func TestNormalizeInventoryFiltersRejectsUnsupportedGrouping(t *testing.T) {
	_, err := normalizeInventoryFilters(InventoryFilters{Grouping: "topology"})
	require.ErrorContains(t, err, "unsupported inventory grouping")
}

func TestNormalizeInventoryFiltersAcceptsSimilarity(t *testing.T) {
	minConfidence := 0.9
	got, err := normalizeInventoryFilters(InventoryFilters{Grouping: InventoryGroupingSimilarity, MinDedupConfidence: &minConfidence})
	require.NoError(t, err)
	require.Equal(t, InventoryGroupingSimilarity, got.Grouping)
	require.NotNil(t, got.MinDedupConfidence)
	require.InDelta(t, 0.9, *got.MinDedupConfidence, 0.0001)
}

func TestInventoryDeviceTagsIncludeDerivedOperationalTags(t *testing.T) {
	device := &inventoryDeviceRow{OwnerID: "Security", LocationID: "Floor-2", Active: true, Registered: true}
	require.Equal(t, []string{"device", "registered", "active", "owner:security", "location:floor-2"}, inventoryDeviceTags(device))
}

func TestStoredTagClausesExcludeDerivedTags(t *testing.T) {
	clauses := []string{"1 = 1"}
	args := []any{}
	addStoredTagClauses(&clauses, &args, []string{"managed", "active", "owner:security", "location:lab", "registered", "device"})
	require.Len(t, clauses, 2)
	require.Contains(t, clauses[1], "jsonb_array_elements_text(tags)")
	require.Equal(t, []any{"managed"}, args)
	require.True(t, isDerivedInventoryTag("owner:security"))
	require.False(t, isDerivedInventoryTag("managed"))
}

func TestInventoryGroupingBuildsCMDBEdges(t *testing.T) {
	device := inventoryDeviceRow{MAC: "aa:bb", OwnerID: "security", LocationID: "floor-2", KnownMACs: []string{"aa:bb", "cc:dd"}}
	nodes := map[string]InventoryNode{}
	edges := map[string]InventoryEdge{}
	addInventoryDevice(nodes, edges, device, InventoryGroupingCMDB)
	require.Contains(t, nodes, "owner:security")
	require.Contains(t, nodes, "location:floor-2")
	require.Contains(t, edges, "owns:owner:security:device:aa:bb")
}
