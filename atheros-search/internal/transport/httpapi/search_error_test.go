package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/embed"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/search"
)

func TestWriteSearchErrorRendersStableDegradationBody(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeSearchError(recorder, &search.UnavailableError{
		Code:    search.FallbackCapacityExhausted,
		RetryAt: time.Now().Add(45 * time.Second),
		Message: "semantic backend capacity exhausted",
	})

	require.Equal(t, http.StatusServiceUnavailable, recorder.Code)
	retryAfter := recorder.Header().Get("Retry-After")
	require.NotEmpty(t, retryAfter)
	require.Positive(t, mustAtoi(t, retryAfter))
	require.LessOrEqual(t, mustAtoi(t, retryAfter), 45)

	var body map[string]string
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
	require.Equal(t, "semantic backend capacity exhausted", body["error"])
	require.Equal(t, search.FallbackCapacityExhausted, body["code"])
}

func TestWriteSearchErrorOmitsRetryAfterWithoutRetryHint(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeSearchError(recorder, &search.UnavailableError{
		Code:    search.FallbackBackendUnavailable,
		Message: "semantic backend unavailable",
	})

	require.Equal(t, http.StatusServiceUnavailable, recorder.Code)
	require.Empty(t, recorder.Header().Get("Retry-After"))
}

func TestWriteSearchErrorStillRedactsUnexpectedFailures(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeSearchError(recorder, errInternal{})

	require.Equal(t, http.StatusInternalServerError, recorder.Code)
	var body map[string]string
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
	require.Equal(t, "internal server error", body["error"])
}

func TestHTTPStatusFromErrorClassifiesDegradationAndBadRequests(t *testing.T) {
	require.Equal(t, http.StatusServiceUnavailable, httpStatusFromError(&search.UnavailableError{Code: search.FallbackBackendUnavailable}))
	require.Equal(t, http.StatusBadRequest, httpStatusFromError(embed.ErrInvalidRequest))
	require.Equal(t, http.StatusBadRequest, httpStatusFromError(embed.ErrOversizedInput))
}

func TestErrorProducerMatchesSharedUIFixtures(t *testing.T) {
	data, err := os.ReadFile("../../../testdata/contracts/errors.json")
	require.NoError(t, err)
	var fixtures []struct {
		Status int               `json:"status"`
		Body   map[string]string `json:"body"`
	}
	require.NoError(t, json.Unmarshal(data, &fixtures))
	for _, fixture := range fixtures {
		recorder := httptest.NewRecorder()
		if fixture.Status == http.StatusServiceUnavailable {
			writeSearchError(recorder, &search.UnavailableError{Code: fixture.Body["code"], Message: fixture.Body["error"]})
		} else {
			message := fixture.Body["error"]
			if fixture.Status == http.StatusInternalServerError {
				message = "private database failure"
			}
			writeError(recorder, fixture.Status, message)
		}
		require.Equal(t, fixture.Status, recorder.Code)
		expected, err := json.Marshal(fixture.Body)
		require.NoError(t, err)
		require.JSONEq(t, string(expected), recorder.Body.String())
	}
}

type errInternal struct{}

func (errInternal) Error() string { return "sql: connection to postgres.example.test refused" }

func mustAtoi(t *testing.T, value string) int {
	t.Helper()
	parsed := 0
	for _, r := range value {
		if r < '0' || r > '9' {
			t.Fatalf("Retry-After %q is not a plain integer", value)
		}
		parsed = parsed*10 + int(r-'0')
	}
	return parsed
}
