package main

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
	defer database.Close()
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
	defer database.Close()
	mock.ExpectExec("WHERE status = 'failed'\\s+AND attempt_count < max_attempts").
		WillReturnResult(sqlmock.NewResult(0, 1))

	require.NoError(t, retryFailedJobs(context.Background(), database, zerolog.Nop()))
	require.NoError(t, mock.ExpectationsWereMet())
}
