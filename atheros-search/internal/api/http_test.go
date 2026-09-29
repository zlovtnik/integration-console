package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/search"
)

func TestNetworkRejectsUnknownOrEmptyFocusWithoutWideQuery(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := StartHTTP(ctx, 0, nil, nil, nil, nil, nil, false, zerolog.Nop())
	require.NoError(t, err)
	defer server.Close()
	for _, body := range []string{`{"ap_id":"missing"}`, `{"ap_bssid":null}`, `{"ap_bssid":""}`} {
		request := httptest.NewRequest(http.MethodPost, "https://gateway.rclabs.uk/v1/network-map", strings.NewReader(body))
		response := httptest.NewRecorder()
		server.Handler.ServeHTTP(response, request)
		require.Equal(t, http.StatusBadRequest, response.Code)
	}
}

func TestPublicV1HealthzRoute(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := StartHTTP(ctx, 0, []string{"https://search.rclabs.uk"}, nil, nil, nil, nil, false, zerolog.Nop())
	require.NoError(t, err)
	defer server.Close()

	request := httptest.NewRequest(http.MethodGet, "https://gateway.rclabs.uk/v1/healthz", nil)
	request.Header.Set("Origin", "https://search.rclabs.uk")
	response := httptest.NewRecorder()
	server.Handler.ServeHTTP(response, request)

	require.Equal(t, http.StatusOK, response.Code)
	require.JSONEq(t, `{"status":"ok"}`, response.Body.String())
	require.Equal(t, "https://search.rclabs.uk", response.Header().Get("Access-Control-Allow-Origin"))
}

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
		{name: "inventory sort validation", err: errors.New("unsupported inventory sort"), want: http.StatusBadRequest},
		{name: "cursor validation", err: errors.New("invalid page_cursor"), want: http.StatusBadRequest},
		{name: "range validation", err: errors.New("observed_after must be before observed_before"), want: http.StatusBadRequest},
		{name: "search query validation", err: errors.New("search query is required and must contain meaningful terms"), want: http.StatusBadRequest},
		{name: "merge decision validation", err: errors.New("unsupported merge decision \"undo_merge\""), want: http.StatusBadRequest},
		{name: "merge candidate missing", err: errors.New("merge candidate not found"), want: http.StatusNotFound},
		{name: "merge already decided", err: errors.New("merge candidate already decided"), want: http.StatusConflict},
		{name: "annotation conflict", err: search.ErrAnnotationConflict, want: http.StatusConflict},
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

func TestExplainHTTPReturnsDirectRecordAvailability(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()
	mock.ExpectQuery("FROM atheros_search.search_documents").
		WithArgs("device-key", "device").
		WillReturnRows(sqlmock.NewRows([]string{
			"document_id", "source_id", "source_table", "source_kind", "status",
			"source_mac", "bssid", "ssid", "location_id", "sensor_id", "frame_subtype",
			"classification", "title", "producer", "tags", "security_flags",
			"handshake_captured", "host", "blocked", "proxy_event_type", "proxy_device_id",
			"observed_at", "window_start", "window_end", "normalized_sha256", "detail_json",
		}).AddRow(
			"doc-1", "device-key", "devices", "device", "active",
			"aa:bb:cc:dd:ee:01", "", "", "lab", "sensor", "", "", "Laptop", "octopus",
			[]byte(`[]`), 0, false, "", nil, "", "",
			time.Date(2026, 3, 4, 9, 15, 0, 0, time.UTC), nil, nil, "sha", `{"registered":true}`,
		))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := StartHTTP(ctx, 0, nil, &search.Service{Pool: database}, nil, nil, nil, false, zerolog.Nop())
	require.NoError(t, err)
	defer server.Close()

	request := httptest.NewRequest(http.MethodGet, "https://gateway.rclabs.uk/v1/explain/device-key?kind=device", nil)
	response := httptest.NewRecorder()
	server.Handler.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code)

	var body struct {
		SourceKey    string `json:"sourceKey"`
		Found        bool   `json:"found"`
		SourceKind   string `json:"source_kind"`
		DetailJSON   string `json:"detail_json"`
		RecordMAC    string `json:"-"`
		RecordSource struct {
			SourceMAC string `json:"source_mac"`
			Title     string `json:"title"`
		} `json:"record"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
	require.Equal(t, "device-key", body.SourceKey)
	require.True(t, body.Found)
	require.Equal(t, "device", body.SourceKind)
	require.Equal(t, `{"registered":true}`, body.DetailJSON)
	require.Equal(t, "aa:bb:cc:dd:ee:01", body.RecordSource.SourceMAC)
	require.Equal(t, "Laptop", body.RecordSource.Title)
	require.NoError(t, mock.ExpectationsWereMet())
}

// A malformed query parameter is a client error. httpStatusFromError has no
// substring match for the record-context parameter messages, so the handler
// must choose the status itself rather than delegating.
func TestRecordContextRejectsMalformedQueryParameters(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := StartHTTP(ctx, 0, nil, &search.Service{}, nil, nil, nil, false, zerolog.Nop())
	require.NoError(t, err)
	defer server.Close()

	for name, target := range map[string]string{
		"non-numeric bucket":  "/v1/records/key/context?bucket_minutes=abc",
		"zero bucket":         "/v1/records/key/context?bucket_minutes=0",
		"out-of-range bucket": "/v1/records/key/context?bucket_minutes=99999",
		"malformed window":    "/v1/records/key/context?window=not-a-duration",
		"negative window":     "/v1/records/key/context?window=-5h",
	} {
		t.Run(name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "https://gateway.rclabs.uk"+target, nil)
			response := httptest.NewRecorder()
			server.Handler.ServeHTTP(response, request)
			require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
			var body map[string]string
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
			require.NotEmpty(t, body["error"])
		})
	}
}
