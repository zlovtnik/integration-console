package embed

import (
	"context"
	"math"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestClientPrefixesEveryChunkExactlyOnce(t *testing.T) {
	for _, lane := range []Lane{LaneInteractive, LaneWorker} {
		t.Run(string(lane), func(t *testing.T) {
			fake := &llamaFake{}
			server := fake.server()
			defer server.Close()
			client := NewHTTPClient(server.URL, "nomic-embed-text-v2-moe", 2, 512)
			client.PrefixOwner = "client"
			vectors, err := client.Embed(WithLane(context.Background(), lane), []string{"search_document: search_query: " + strings.Repeat("synthetic ", 481)}, KindEvent)
			require.NoError(t, err)
			require.Len(t, vectors, 1)
			prefix := "search_query: "
			if lane == LaneWorker {
				prefix = "search_document: "
			}
			fake.mu.Lock()
			defer fake.mu.Unlock()
			chunks := 0
			for _, request := range fake.embeddings {
				for _, text := range request.Input {
					chunks++
					require.True(t, strings.HasPrefix(text, prefix))
					require.Equal(t, 1, strings.Count(text, "search_"))
					require.LessOrEqual(t, len(strings.Fields(text))+2, 512)
				}
			}
			require.Equal(t, 2, chunks)
		})
	}
}

func TestModernPrefixRejectsEmptyInputsBeforeBackend(t *testing.T) {
	client := NewHTTPClient("http://127.0.0.1:1", "model", 768, 512)
	client.PrefixOwner = "client"
	for _, text := range []string{"", " ", "search_query:", "search_document: search_query: "} {
		_, err := client.Embed(context.Background(), []string{text}, KindEvent)
		require.ErrorIs(t, err, ErrInvalidRequest)
	}
}

func TestVectorValidationIncludesPooledCancellation(t *testing.T) {
	require.Error(t, ValidateVector(make([]float32, 768), 768))
	require.Error(t, ValidateVector([]float32{1}, 768))
	require.Error(t, ValidateVector([]float32{float32(math.Inf(1))}, 1))
	require.Error(t, ValidateVector(meanVectors([][]float32{{1}, {-1}}, 1), 1))
	require.NoError(t, ValidateVector([]float32{1}, 1))
}
