package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestHTTPStatusFromError(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		err  error
		want int
	}{
		{name: "nil", err: nil, want: http.StatusOK},
		{name: "deadline", err: context.DeadlineExceeded, want: http.StatusGatewayTimeout},
		{name: "canceled", err: context.Canceled, want: http.StatusGatewayTimeout},
		{name: "too large", err: errors.New("request body too large"), want: http.StatusRequestEntityTooLarge},
		{name: "inventory validation", err: errors.New("unsupported inventory grouping \"topology\""), want: http.StatusBadRequest},
		{name: "range validation", err: errors.New("observed_after must be before observed_before"), want: http.StatusBadRequest},
		{name: "search query validation", err: errors.New("search query is required and must contain meaningful terms"), want: http.StatusBadRequest},
		{name: "generic required failure", err: errors.New("required background cleanup failed"), want: http.StatusInternalServerError},
		{name: "fallback", err: errors.New("boom"), want: http.StatusInternalServerError},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := httpStatusFromError(tc.err); got != tc.want {
				t.Fatalf("httpStatusFromError(%v) = %d, want %d", tc.err, got, tc.want)
			}
		})
	}
}

func TestWriteErrorRedactsServerFailures(t *testing.T) {
	serverFailure := httptest.NewRecorder()
	writeError(serverFailure, http.StatusInternalServerError, "database password is invalid")
	require.Equal(t, http.StatusInternalServerError, serverFailure.Code)
	var serverBody map[string]string
	require.NoError(t, json.Unmarshal(serverFailure.Body.Bytes(), &serverBody))
	require.Equal(t, "internal server error", serverBody["error"])

	clientFailure := httptest.NewRecorder()
	writeError(clientFailure, http.StatusBadRequest, "source_key is required")
	var clientBody map[string]string
	require.NoError(t, json.Unmarshal(clientFailure.Body.Bytes(), &clientBody))
	require.Equal(t, "source_key is required", clientBody["error"])
}
