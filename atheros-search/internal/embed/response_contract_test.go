package embed

import (
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestEmbeddingBackendRequestAndResponseContracts(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
		invalid    bool
	}{
		{"openai", `{"data":[{"embedding":[1,2]},{"embedding":[3,4]}]}`, 200, false},
		{"embeddings", `{"embeddings":[[1,2],[3,4]]}`, 200, false},
		{"count", `{"embeddings":[[1,2]]}`, 200, true},
		{"dimensions", `{"embeddings":[[1],[3,4]]}`, 200, true},
		{"zero norm", `{"embeddings":[[0,0],[3,4]]}`, 200, true},
		{"malformed", `{`, 200, true},
		{"nonfinite", `{"embeddings":[[1e100,2],[3,4]]}`, 200, true},
		{"capacity", `{"error":"capacity exhausted"}`, 429, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				require.Equal(t, "/v1/embeddings", r.URL.Path)
				require.Equal(t, http.MethodPost, r.Method)
				require.Equal(t, "application/json", r.Header.Get("Content-Type"))
				var request embeddingsRequest
				require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
				require.Equal(t, "contract-model", request.Model)
				require.Equal(t, []string{"first", "second"}, request.Input)
				w.WriteHeader(tc.status)
				_, err := w.Write([]byte(tc.body))
				require.NoError(t, err)
			}))
			defer server.Close()
			client := &HTTPClient{BaseURL: server.URL, Model: "contract-model", Dimensions: 2, Client: server.Client()}
			vectors, err := client.embedOnce(t.Context(), []string{"first", "second"})
			if tc.invalid {
				var unavailable *BackendUnavailableError
				require.ErrorAs(t, err, &unavailable)
				_, retry := RetryTime(err)
				require.True(t, retry)
				if tc.status == 200 {
					require.ErrorIs(t, err, ErrInvalidResponse)
				}
			} else {
				require.NoError(t, err)
				require.Equal(t, [][]float32{{1, 2}, {3, 4}}, vectors)
			}
		})
	}
}

func TestEmbedRejectsInvalidPooledVectorsWithoutBackendRetry(t *testing.T) {
	for _, tc := range []struct {
		name               string
		positive, negative float32
	}{
		{name: "cancellation", positive: 1, negative: -1},
		{name: "overflow", positive: math.MaxFloat32, negative: math.MaxFloat32},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request embeddingsRequest
				require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
				vectors := make([][]float32, len(request.Input))
				for i, text := range request.Input {
					value := float32(1)
					if strings.HasPrefix(text, "positive ") {
						value = tc.positive
					} else if strings.HasPrefix(text, "negative ") {
						value = tc.negative
					}
					vectors[i] = []float32{value}
				}
				require.NoError(t, json.NewEncoder(w).Encode(embeddingsResponse{Embeddings: vectors}))
			}))
			defer server.Close()
			client := NewHTTPClient(server.URL, "contract-model", 1, 512)
			client.tokenizer = newVocabTokenizer()
			texts := []string{"healthy", strings.Repeat("positive ", ChunkTokenLimit) + strings.Repeat("negative ", ChunkTokenLimit)}
			vectors, err := client.Embed(t.Context(), texts, KindEvent)
			require.Nil(t, vectors)
			require.ErrorIs(t, err, ErrInvalidRequest)
			require.ErrorContains(t, err, "pooled embedding input 1")
			require.NotErrorIs(t, err, ErrBackendUnavailable)
			require.NotErrorIs(t, err, ErrInvalidResponse)
			_, retry := RetryTime(err)
			require.False(t, retry)
			require.False(t, IsCircuitFailure(t.Context(), err))
		})
	}
}
