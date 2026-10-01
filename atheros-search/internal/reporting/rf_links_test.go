package reporting

import (
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestRFLinksRequireQualifyingOverlapAndRespectLimit(t *testing.T) {
	for _, limit := range []int{0, 1, 2} {
		t.Run(time.Duration(limit).String(), func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			t.Cleanup(func() { _ = db.Close() }) // Best-effort fixture teardown.
			mock.ExpectBegin()
			tx, err := db.BeginTx(t.Context(), nil)
			require.NoError(t, err)
			response := &InvestigationResponse{Nodes: []GraphNode{
				{Kind: "device", MAC: "aa:bb:cc:dd:ee:01"},
				{Kind: "device", MAC: "aa:bb:cc:dd:ee:02"},
			}}
			if limit > 0 {
				mock.ExpectQuery("WITH rf_sensor_windows").WillReturnRows(sqlmock.NewRows([]string{"left", "right", "windows", "sensors", "last_seen", "refs"}).
					AddRow("a", "b", 5, 1, time.Now(), "weak").
					AddRow("a", "c", 2, 2, time.Now(), "qualifying").
					AddRow("a", "d", 3, 3, time.Now(), "qualifying"))
			}
			start, end := time.Now().Add(-time.Hour), time.Now()
			err = (&Service{Pool: db}).investigationRFSimilarityLinks(t.Context(), tx, InvestigationRequest{EdgeLimit: limit, ObservedAfter: &start, ObservedBefore: &end}, response, start)
			require.NoError(t, err)
			require.Len(t, response.Links, limit)
			for _, link := range response.Links {
				require.NotEqual(t, "device:b", link.Target)
			}
			mock.ExpectRollback()
			require.NoError(t, tx.Rollback())
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}
