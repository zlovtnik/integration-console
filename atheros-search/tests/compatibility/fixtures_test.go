package compatibility

import (
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/reportmeta"
	searchv1 "github.com/zlovtnik/ssl-proxy/services/atheros-search/proto/atheros/search/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestSearchProducerMatchesSharedUIFixture(t *testing.T) {
	observed := time.Date(2026, 9, 1, 11, 0, 0, 0, time.UTC)
	blocked := false
	report, err := reportmeta.Proto(reportmeta.New(nil, "versioned source record", "returned records", "event times", 2, nil))
	require.NoError(t, err)
	response := &searchv1.SearchResponse{
		QueryId: 42,
		Results: []*searchv1.SearchResult{
			{SourceKey: "synthetic-record", SourceTable: "wireless_frames", SourceMac: "aa:bb:cc:dd:ee:01", ObservedAt: timestamppb.New(observed), Score: 0.5, KeywordRank: 0.25, Tags: []string{"synthetic"}, SourceKind: "event", DetailJson: "{}", Blocked: &blocked},
			{SourceKey: "synthetic-nullable", SourceKind: "device"},
		},
		ModeUsed: searchv1.SearchMode_SEARCH_MODE_SPARSE, FallbackReason: "semantic backend capacity exhausted", FallbackCode: "embedding_capacity_exhausted", FallbackRetryAt: timestamppb.New(observed.Add(time.Minute)), SparseResultCount: 2, FusedResultCount: 2, Report: report, GeneratedAt: timestamppb.New(observed),
	}
	actual, err := protojson.Marshal(response)
	require.NoError(t, err)
	expected, err := os.ReadFile("../../testdata/contracts/search.json")
	require.NoError(t, err)
	require.JSONEq(t, string(expected), string(actual))
}
