package worker

import (
	"math"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestInsertVectorRejectsNonfiniteValuesBeforePersistence(t *testing.T) {
	for _, value := range []float32{float32(math.NaN()), float32(math.Inf(1))} {
		db, mock, err := sqlmock.New()
		require.NoError(t, err)
		t.Cleanup(func() { _ = db.Close() }) // Best-effort fixture teardown.
		mock.ExpectBegin()
		tx, err := db.BeginTx(t.Context(), nil)
		require.NoError(t, err)
		vector := testVector()
		vector[0] = value
		err = insertVector(t.Context(), tx, "document", "event", "model", "checksum", vector)
		require.ErrorContains(t, err, "non-finite")
		mock.ExpectRollback()
		require.NoError(t, tx.Rollback())
		require.NoError(t, mock.ExpectationsWereMet())
	}
}
