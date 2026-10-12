package db

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestCountEmbeddingsReturnsCountsByKind(t *testing.T) {
	sqlDB, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })

	mock.ExpectQuery("SELECT").WillReturnRows(
		sqlmock.NewRows([]string{"event", "device", "behaviour", "sequence", "event_documents", "device_documents"}).
			AddRow(4, 0, 0, 0, true, false),
	)

	counts, err := (&Pool{DB: sqlDB}).CountEmbeddings(context.Background())
	require.NoError(t, err)
	require.Equal(t, EmbeddingCounts{Event: 4, HasEventDocuments: true}, counts)
	require.Empty(t, counts.EmptyKinds())
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestEmptyKindsWarnsOnlyForSupportedKindsWithSourceDocuments(t *testing.T) {
	require.Empty(t, EmbeddingCounts{}.EmptyKinds())
	require.Empty(t, EmbeddingCounts{Event: 1, Device: 1, HasEventDocuments: true, HasDeviceDocuments: true}.EmptyKinds())
	require.Equal(t, []string{"event", "device"}, EmbeddingCounts{HasEventDocuments: true, HasDeviceDocuments: true}.EmptyKinds())
	require.Equal(t, []string{"device"}, EmbeddingCounts{Event: 4, HasEventDocuments: true, HasDeviceDocuments: true}.EmptyKinds())
}
