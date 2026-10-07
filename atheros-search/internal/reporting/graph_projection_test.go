package reporting

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestStreamGraphDefaultsToTopologyAndKeepsIdentitySeparate(t *testing.T) {
	filters, err := NormalizeGraphFilters(GraphFilters{Projection: "stream"})
	require.NoError(t, err)
	require.Contains(t, filters.Kinds, "sensor")
	require.Contains(t, filters.Kinds, "location")
	require.NotContains(t, filters.Kinds, "cluster")
	require.NotContains(t, filters.EdgeKinds, "identity_membership")
	require.NotContains(t, graphEdgesTable(filters), "identity:' || member.cluster_id")
	filters, err = NormalizeGraphFilters(GraphFilters{Projection: "stream", IncludeIdentity: true})
	require.NoError(t, err)
	require.Contains(t, filters.Kinds, "cluster")
	require.Contains(t, filters.EdgeKinds, "identity_membership")
	require.Contains(t, graphEdgesTable(filters), "'identity:' || member.cluster_id, 'device:' || member.mac")
}

func TestGraphRangeRequiresCalibratedSensorToDeviceAndCurrentEvidence(t *testing.T) {
	now := time.Now().UTC()
	evidence, err := json.Marshal(map[string]any{"range": GraphRange{
		Meters: 10, ErrorMeters: 4, LowerMeters: 6, UpperMeters: 14,
		SampleCount: 10, CalibrationVersion: "review-v1", ObservedAt: now, ValidUntil: now.Add(time.Minute),
	}})
	require.NoError(t, err)
	row := graphEdgeRow{SourceID: "sensor:one", TargetID: "device:two", EdgeKind: "calibrated_range", Evidence: string(evidence)}
	require.NotNil(t, graphEdgeFromRow(row, now).Range)
	require.Nil(t, graphEdgeFromRow(row, now.Add(2*time.Minute)).Range)
	row.SourceID = "device:one"
	require.Nil(t, graphEdgeFromRow(row, now).Range)
	row.SourceID = "sensor:one"
	row.EdgeKind = "observed_association"
	require.Nil(t, graphEdgeFromRow(row, now).Range)
}

func TestGraphRetainsMultipleAccessPointAssociations(t *testing.T) {
	nodes := []GraphNode{{ID: "device:one", Kind: "device"}, {ID: "ap:one", Kind: "ap"}, {ID: "ap:two", Kind: "ap"}}
	edges := []GraphEdge{
		{ID: "one", Source: "device:one", Target: "ap:one", Kind: "observed_association"},
		{ID: "two", Source: "device:one", Target: "ap:two", Kind: "observed_association"},
	}
	_, focused := focusGraphAroundMAC(nodes, edges, "one", 1)
	require.Len(t, focused, 2)
}
