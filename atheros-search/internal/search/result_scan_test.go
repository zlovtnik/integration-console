package search

import (
	"database/sql/driver"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestResultDecodersPreserveNullableFieldsAndUTCTimes(t *testing.T) {
	for _, sparse := range []bool{false, true} {
		t.Run(map[bool]string{false: "dense", true: "sparse"}[sparse], func(t *testing.T) {
			for _, nullable := range []bool{false, true} {
				database, mock, err := sqlmock.New()
				require.NoError(t, err)
				t.Cleanup(func() { require.NoError(t, database.Close()) })
				observed := time.Date(2026, 9, 1, 12, 0, 0, 0, time.FixedZone("offset", 3600))
				var timestamp, blocked driver.Value = observed, false
				if nullable {
					timestamp, blocked = nil, nil
				}
				values := []driver.Value{"key", "wireless_frames", "event", "aa:bb:cc:dd:ee:ff", "lab", "sensor", timestamp, "bssid", "ssid", "data", 0.75}
				if sparse {
					values = append(values, 0.25)
				}
				values = append(values, `["z","a","a"]`, "null", int64(4), true, "host", blocked, "request", "device", timestamp, timestamp, "unknown")
				columns := make([]string, len(values))
				for i := range columns {
					columns[i] = "column"
				}
				mock.ExpectQuery("SELECT").WillReturnRows(sqlmock.NewRows(columns).AddRow(values...))
				rows, err := database.Query("SELECT")
				require.NoError(t, err)
				require.True(t, rows.Next())
				decode := scanDenseResult
				if sparse {
					decode = scanSparseResult
				}
				result, err := decode(rows)
				require.NoError(t, err)
				require.NoError(t, rows.Close())
				require.Equal(t, float32(0.75), result.CosineSimilarity)
				if sparse {
					require.Equal(t, float32(0.25), result.KeywordRank)
				}
				require.Equal(t, []string{"a", "z"}, result.Tags)
				require.Equal(t, "{}", result.DetailJSON)
				require.Equal(t, int32(4), result.securityFlags)
				require.True(t, result.handshakeCaptured)
				if nullable {
					require.Nil(t, result.ObservedAt)
					require.Nil(t, result.WindowStart)
					require.Nil(t, result.WindowEnd)
					require.Nil(t, result.Blocked)
				} else {
					require.Equal(t, observed.UTC(), *result.ObservedAt)
					require.Equal(t, time.UTC, result.WindowStart.Location())
					require.Equal(t, time.UTC, result.WindowEnd.Location())
					require.False(t, *result.Blocked)
				}
				require.NoError(t, mock.ExpectationsWereMet())
				mock.ExpectClose()
			}
		})
	}
}
