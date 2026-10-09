package repair

import (
	"context"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
)

func TestShowStatusReturnsCountQueryErrors(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer func() { _ = database.Close() }() // Best-effort test teardown; assertions verify the operation before cleanup.
	mock.ExpectQuery("SELECT status, COUNT\\(\\*\\) AS count").
		WillReturnRows(sqlmock.NewRows([]string{"status", "count"}).AddRow("pending", 1))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\) FROM embedding_jobs").WillReturnError(errors.New("schema unavailable"))

	err = showStatus(context.Background(), database, zerolog.Nop())
	require.EqualError(t, err, "schema unavailable")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRetryFailedJobsDoesNotResetPendingJobs(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer func() { _ = database.Close() }() // Best-effort test teardown; assertions verify the operation before cleanup.
	mock.ExpectExec("WHERE status = 'failed'\\s+AND attempt_count < max_attempts").
		WillReturnResult(sqlmock.NewResult(0, 1))

	require.NoError(t, retryFailedJobs(context.Background(), database, zerolog.Nop()))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCancelSupersededDryRunCountsWithoutWriting(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer func() { _ = database.Close() }() // Best-effort test teardown; assertions verify the operation before cleanup.
	mock.ExpectQuery("SELECT COUNT\\(\\*\\)").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(51353))

	require.NoError(t, cancelSupersededJobs(context.Background(), database, zerolog.Nop(), 5000, true))
	// No Exec expectation is registered, so any write fails the test.
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCancelSupersededClearsLeaseColumns(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer func() { _ = database.Close() }() // Best-effort test teardown; assertions verify the operation before cleanup.
	// The embedding_jobs_lease_ck CHECK rejects a non-leased row that keeps an
	// owner, so the transition has to clear the lease columns with the status.
	mock.ExpectExec("SET status = 'cancelled',\\s+owner_id = NULL,\\s+lease_token = NULL,\\s+lease_expires_at = NULL").
		WithArgs(5000).
		WillReturnResult(sqlmock.NewResult(0, 5000))

	require.NoError(t, cancelSupersededJobs(context.Background(), database, zerolog.Nop(), 5000, false))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCancelSupersededOnlyTargetsNonTerminalJobsOnNonActiveDocuments(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer func() { _ = database.Close() }() // Best-effort test teardown; assertions verify the operation before cleanup.
	mock.ExpectExec("document\\.status <> 'active'\\s+AND job\\.status IN \\('pending', 'leased'\\)").
		WithArgs(10).
		WillReturnResult(sqlmock.NewResult(0, 3))

	require.NoError(t, cancelSupersededJobs(context.Background(), database, zerolog.Nop(), 10, false))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCancelOrphanedDryRunCountsWithoutWriting(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer func() { _ = database.Close() }() // Best-effort test teardown; assertions verify the operation before cleanup.
	mock.ExpectQuery("NOT EXISTS").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(12))

	require.NoError(t, cancelOrphanedJobs(context.Background(), database, zerolog.Nop(), 5000, true))
	// No Exec expectation is registered, so any write fails the test.
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCancelOrphanedTargetsMissingDocumentsOnly(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer func() { _ = database.Close() }() // Best-effort test teardown; assertions verify the operation before cleanup.
	mock.ExpectExec("NOT EXISTS \\(\\s*SELECT 1 FROM atheros_search\\.search_documents").
		WithArgs(10).
		WillReturnResult(sqlmock.NewResult(0, 4))

	require.NoError(t, cancelOrphanedJobs(context.Background(), database, zerolog.Nop(), 10, false))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCancelOrphanedClearsLeaseColumns(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer func() { _ = database.Close() }() // Best-effort test teardown; assertions verify the operation before cleanup.
	mock.ExpectExec("SET status = 'cancelled',\\s+owner_id = NULL,\\s+lease_token = NULL,\\s+lease_expires_at = NULL").
		WithArgs(5000).
		WillReturnResult(sqlmock.NewResult(0, 5000))

	require.NoError(t, cancelOrphanedJobs(context.Background(), database, zerolog.Nop(), 5000, false))
	require.NoError(t, mock.ExpectationsWereMet())
}
