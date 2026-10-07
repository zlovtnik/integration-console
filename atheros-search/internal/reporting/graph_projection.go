package reporting

import (
	"encoding/json"
	"strings"
	"time"
)

// These are fixed SQL fragments, never request-provided table names. Approved
// identity membership remains a separate relation from observed topology.
func graphNodesTable(filters GraphFilters) string {
	if filters.Projection != "stream" {
		return "atheros_search.graph_nodes"
	}
	topology := `(SELECT node_id, node_kind, label, node_payload, location_id, sensor_id,
 normalized_mac, normalized_ssid, is_threat, observed_at
 FROM atheros_search.wireless_topology_nodes`
	if !filters.IncludeIdentity {
		return topology + `)`
	}
	return topology + `
 UNION ALL SELECT 'identity:' || cluster_id, 'identity_cluster', cluster_name,
 jsonb_build_object('cluster_size', cluster_size), NULL, NULL, NULL, NULL, false, last_seen
 FROM atheros_search.identity_clusters WHERE status = 'active')`
}

func graphEdgesTable(filters GraphFilters) string {
	if filters.Projection != "stream" {
		return "atheros_search.graph_edges"
	}
	topology := `(SELECT edge_id, source_node_id, target_node_id, edge_kind, weight, weight_basis,
 label, observed_at, evidence FROM atheros_search.wireless_topology_edges
 WHERE (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
 AND (edge_kind <> 'calibrated_range' OR (evidence->'range'->>'valid_until')::timestamptz > CURRENT_TIMESTAMP)`
	if !filters.IncludeIdentity {
		return topology + `)`
	}
	return topology + `
 UNION ALL SELECT 'membership:' || member.cluster_id || ':' || member.mac,
 'identity:' || member.cluster_id, 'device:' || member.mac, 'identity_membership',
 member.confidence, 'reviewed_identity', 'Reviewed identity membership', member.last_seen, member.evidence
 FROM atheros_search.identity_cluster_members member
 JOIN atheros_search.identity_clusters cluster ON cluster.cluster_id = member.cluster_id
 WHERE cluster.status = 'active')`
}

type GraphRange struct {
	Meters             float64   `json:"meters"`
	ErrorMeters        float64   `json:"error_meters"`
	LowerMeters        float64   `json:"lower_meters"`
	UpperMeters        float64   `json:"upper_meters"`
	Confidence         string    `json:"confidence"`
	CalibrationVersion string    `json:"calibration_version"`
	SampleCount        int64     `json:"sample_count"`
	ObservedAt         time.Time `json:"observed_at"`
	ValidUntil         time.Time `json:"valid_until"`
}

func graphEdgeFromRow(row graphEdgeRow, now time.Time) GraphEdge {
	edge := GraphEdge{ID: row.EdgeID, Source: row.SourceID, Target: row.TargetID,
		Kind: mapGraphEdgeKind(row.EdgeKind), Weight: &row.Weight,
		WeightBasis: row.WeightBasis.String, Label: row.Label.String}
	var evidence struct {
		WindowStart         *time.Time  `json:"window_start"`
		WindowEnd           *time.Time  `json:"window_end"`
		ExpiresAt           *time.Time  `json:"expires_at"`
		ProjectionWatermark *time.Time  `json:"projection_watermark"`
		ProjectedAt         *time.Time  `json:"projected_at"`
		Range               *GraphRange `json:"range"`
	}
	if json.Unmarshal([]byte(row.Evidence), &evidence) == nil {
		edge.EvidenceStart, edge.EvidenceEnd, edge.ExpiresAt = evidence.WindowStart, evidence.WindowEnd, evidence.ExpiresAt
		edge.ProjectionWatermark, edge.ProjectedAt = evidence.ProjectionWatermark, evidence.ProjectedAt
		if row.EdgeKind == "calibrated_range" && strings.HasPrefix(row.SourceID, "sensor:") &&
			strings.HasPrefix(row.TargetID, "device:") && evidence.Range != nil &&
			evidence.Range.ValidUntil.After(now) && evidence.Range.Meters > 0 &&
			evidence.Range.ErrorMeters >= 0 && evidence.Range.SampleCount >= 2 && evidence.Range.CalibrationVersion != "" {
			edge.Range = evidence.Range
		}
	}
	return edge
}
