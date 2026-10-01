//go:build dbcontract

package assets

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/testdb"
)

func TestDatabaseEntityPaginationPreservesRankedOrdering(t *testing.T) {
	db := testdb.Provision(t)
	_, err := db.ExecContext(t.Context(), `TRUNCATE atheros_search.ap_catalog, atheros_search.devices, atheros_search.asset_annotations CASCADE`)
	require.NoError(t, err)
	now := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	for i := 1; i <= 6; i++ {
		id := fmt.Sprintf("aa:bb:cc:dd:ee:%02d", i)
		ranked := i == 2 || i == 5
		seen := now.Add(time.Duration(i/2) * time.Hour)
		_, err = db.ExecContext(t.Context(), `INSERT INTO atheros_search.ap_catalog (bssid, authorized, first_observed_at, last_observed_at) VALUES ($1,$2,$3,$4)`, id, ranked, now, seen)
		require.NoError(t, err)
		_, err = db.ExecContext(t.Context(), `INSERT INTO atheros_search.devices (mac, registered, first_seen, last_seen) VALUES ($1,$2,$3,$4)`, id, ranked, now, seen)
		require.NoError(t, err)
		if i == 3 || i == 6 {
			for _, kind := range []string{"ap", "device"} {
				_, err = db.ExecContext(t.Context(), `INSERT INTO atheros_search.asset_annotations (asset_kind,asset_id,pinned,revision,updated_by) VALUES ($1,$2,TRUE,1,'contract')`, kind, id)
				require.NoError(t, err)
			}
		}
	}
	svc := &Service{Pool: testdb.Runtime(t)}
	for _, kind := range []string{"ap", "device"} {
		t.Run(kind, func(t *testing.T) {
			whole, err := svc.Entities(t.Context(), kind, "", "", 50)
			require.NoError(t, err)
			var got []EntityChoice
			cursor := ""
			for page := 0; page < 7; page++ {
				response, err := svc.Entities(t.Context(), kind, "", cursor, 1)
				require.NoError(t, err)
				got = append(got, response.Entities...)
				cursor = response.NextPageCursor
				if cursor == "" {
					break
				}
			}
			require.Equal(t, whole.Entities, got)
			require.Len(t, got, 6)
		})
	}
}
