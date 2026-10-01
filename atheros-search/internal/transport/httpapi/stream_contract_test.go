package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/auth"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/etlhealth"
	searchv1 "github.com/zlovtnik/ssl-proxy/services/atheros-search/proto/atheros/search/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

type searchStub struct {
	SearchService
	call func(context.Context, *searchv1.SearchRequest) (*searchv1.SearchResponse, error)
}

func (s searchStub) Search(ctx context.Context, r *searchv1.SearchRequest) (*searchv1.SearchResponse, error) {
	return s.call(ctx, r)
}

func searchMux(t *testing.T, svc SearchService) *runtime.ServeMux {
	t.Helper()
	a, err := auth.NewTokenAuth("")
	require.NoError(t, err)
	mux := runtime.NewServeMux()
	require.NoError(t, registerSearchRoutes(mux, a, svc, zerolog.Nop()))
	return mux
}

func TestSearchNDJSONMatchesSharedFixtureAndTerminates(t *testing.T) {
	data, err := os.ReadFile("../../../testdata/contracts/search.json")
	require.NoError(t, err)
	var response searchv1.SearchResponse
	require.NoError(t, protojson.Unmarshal(data, &response))
	mux := searchMux(t, searchStub{call: func(context.Context, *searchv1.SearchRequest) (*searchv1.SearchResponse, error) {
		return &response, nil
	}})
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/v1/search/stream", strings.NewReader(`{}`)))
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "application/x-ndjson", w.Header().Get("Content-Type"))
	lines := strings.Split(strings.TrimSpace(w.Body.String()), "\n")
	require.Len(t, lines, len(response.Results)+1)
	for i, r := range response.Results {
		expected, err := protojson.Marshal(r)
		require.NoError(t, err)
		require.JSONEq(t, string(expected), lines[i])
	}
	var done struct {
		Type string          `json:"type"`
		Meta json.RawMessage `json:"meta"`
	}
	require.NoError(t, json.Unmarshal([]byte(lines[len(lines)-1]), &done))
	require.Equal(t, "done", done.Type)
	response.Results = nil
	metadata, err := protojson.Marshal(&response)
	require.NoError(t, err)
	require.JSONEq(t, string(metadata), string(done.Meta))
}

func TestSearchStreamPropagatesCancellationAndBodyLimit(t *testing.T) {
	called := false
	mux := searchMux(t, searchStub{call: func(ctx context.Context, _ *searchv1.SearchRequest) (*searchv1.SearchResponse, error) {
		called = true
		return nil, ctx.Err()
	}})
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/v1/search/stream", strings.NewReader(`{}`)).WithContext(ctx))
	require.True(t, called)
	require.Equal(t, http.StatusGatewayTimeout, w.Code)
	called = false
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/v1/search/stream", strings.NewReader(strings.Repeat("x", int(maxRequestBodyBytes)+1))))
	require.Equal(t, http.StatusRequestEntityTooLarge, w.Code)
	require.False(t, called)
}

type failingWriter struct {
	header http.Header
	writes int
}

func (w *failingWriter) Header() http.Header { return w.header }
func (*failingWriter) WriteHeader(int)       {}
func (w *failingWriter) Write([]byte) (int, error) {
	w.writes++
	return 0, errors.New("client disconnected")
}
func TestSearchStreamStopsOnWriteFailure(t *testing.T) {
	mux := searchMux(t, searchStub{call: func(context.Context, *searchv1.SearchRequest) (*searchv1.SearchResponse, error) {
		return &searchv1.SearchResponse{Results: []*searchv1.SearchResult{{SourceKey: "first"}, {SourceKey: "second"}}}, nil
	}})
	w := &failingWriter{header: make(http.Header)}
	mux.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/v1/search/stream", strings.NewReader(`{}`)))
	require.Equal(t, 1, w.writes)
}

type snapshotStub struct{}

func (snapshotStub) Snapshot(context.Context) (etlhealth.ETLHealth, error) {
	return etlhealth.ETLHealth{EmbeddingPending: 42}, nil
}
func TestETLWebSocketSnapshotAndDisconnect(t *testing.T) {
	a, err := auth.NewTokenAuth("")
	require.NoError(t, err)
	mux := runtime.NewServeMux()
	require.NoError(t, registerHealthRoutes(mux, a, nil, snapshotStub{}, true, []string{"https://synthetic.example"}, zerolog.Nop()))
	done := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { defer close(done); mux.ServeHTTP(w, r) }))
	defer server.Close()
	conn, response, err := websocket.DefaultDialer.DialContext(t.Context(), "ws"+strings.TrimPrefix(server.URL, "http")+"/v1/etl/stream", http.Header{"Origin": []string{"https://synthetic.example"}})
	if response != nil {
		require.NoError(t, response.Body.Close())
	}
	require.NoError(t, err)
	defer func() { _ = conn.Close() }() // Best-effort socket cleanup after disconnect.
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(8*time.Second)))
	kind, data, err := conn.ReadMessage()
	require.NoError(t, err)
	require.Equal(t, websocket.TextMessage, kind)
	var snapshot etlhealth.ETLHealth
	require.NoError(t, json.Unmarshal(data, &snapshot))
	require.Equal(t, int64(42), snapshot.EmbeddingPending)
	require.NoError(t, conn.Close())
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("handler retained disconnected client")
	}
}
