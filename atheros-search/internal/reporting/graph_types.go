package reporting

import (
	"database/sql"
	"time"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/reportmeta"
)

const (
	graphDefaultLimit = 200
	GraphMaxLimit     = 1000
	GraphMaxHops      = 2
)

type GraphFilters struct {
	Projection      string     `json:"projection,omitempty"`
	IncludeIdentity bool       `json:"include_identity,omitempty"`
	LocationIDs     []string   `json:"location_ids,omitempty"`
	SensorIDs       []string   `json:"sensor_ids,omitempty"`
	SourceMAC       string     `json:"source_mac,omitempty"`
	SSID            string     `json:"ssid,omitempty"`
	Kinds           []string   `json:"kinds,omitempty"`
	EdgeKinds       []string   `json:"edge_kinds,omitempty"`
	ThreatOnly      bool       `json:"threat_only,omitempty"`
	ObservedAfter   *time.Time `json:"observed_after,omitempty"`
	ObservedBefore  *time.Time `json:"observed_before,omitempty"`
	Hops            int        `json:"hops,omitempty"`
	Limit           int        `json:"limit,omitempty"`
	Scope           string     `json:"scope,omitempty"`
	PageCursor      string     `json:"page_cursor,omitempty"`
	PageSize        int        `json:"page_size,omitempty"`
}

type GraphNode struct {
	ID               string     `json:"id"`
	Kind             string     `json:"kind"`
	Label            string     `json:"label"`
	MAC              string     `json:"mac,omitempty"`
	DisplayName      string     `json:"display_name,omitempty"`
	Username         string     `json:"username,omitempty"`
	Hostname         string     `json:"hostname,omitempty"`
	OSHint           string     `json:"os_hint,omitempty"`
	SSID             string     `json:"ssid,omitempty"`
	BSSID            string     `json:"bssid,omitempty"`
	LocationID       string     `json:"location_id,omitempty"`
	SensorID         string     `json:"sensor_id,omitempty"`
	ClusterSize      *int       `json:"cluster_size,omitempty"`
	RiskScore        *float64   `json:"risk_score,omitempty"`
	AlertType        string     `json:"alert_type,omitempty"`
	AlertSeverity    string     `json:"alert_severity,omitempty"`
	Threat           bool       `json:"threat,omitempty"`
	ExplainSourceKey string     `json:"explain_source_key,omitempty"`
	ExplainKind      string     `json:"explain_kind,omitempty"`
	ObservedAt       *time.Time `json:"created_at,omitempty"`
	FirstSeen        *time.Time `json:"first_seen,omitempty"`
	LastSeen         *time.Time `json:"last_seen,omitempty"`
	Tags             []string   `json:"tags,omitempty"`
}

type GraphEdge struct {
	EvidenceStart       *time.Time  `json:"evidence_start,omitempty"`
	EvidenceEnd         *time.Time  `json:"evidence_end,omitempty"`
	ExpiresAt           *time.Time  `json:"expires_at,omitempty"`
	ProjectionWatermark *time.Time  `json:"projection_watermark,omitempty"`
	ProjectedAt         *time.Time  `json:"projected_at,omitempty"`
	Range               *GraphRange `json:"range,omitempty"`
	ID                  string      `json:"id"`
	Source              string      `json:"source"`
	Target              string      `json:"target"`
	Kind                string      `json:"kind"`
	Weight              *float64    `json:"weight,omitempty"`
	WeightBasis         string      `json:"weight_basis,omitempty"`
	Label               string      `json:"label,omitempty"`
}

type GraphResponse struct {
	Report         *reportmeta.Metadata `json:"report,omitempty"`
	Nodes          []GraphNode          `json:"nodes"`
	Edges          []GraphEdge          `json:"edges"`
	GeneratedAt    time.Time            `json:"generated_at"`
	NodeCount      int                  `json:"node_count"`
	EdgeCount      int                  `json:"edge_count"`
	NextPageCursor string               `json:"next_page_cursor,omitempty"`
	TotalNodeCount *int                 `json:"total_node_count,omitempty"`
	TotalEdgeCount *int                 `json:"total_edge_count,omitempty"`
	FocusReason    string               `json:"focus_reason,omitempty"`
}

type graphNodeRow struct {
	NodeID         string
	NodeKind       string
	Label          sql.NullString
	NodePayload    string
	LocationID     sql.NullString
	SensorID       sql.NullString
	NormalizedMAC  sql.NullString
	NormalizedSSID sql.NullString
	IsThreat       bool
	ObservedAt     sql.NullTime
}

type graphEdgeRow struct {
	Evidence    string
	EdgeID      string
	SourceID    string
	TargetID    string
	EdgeKind    string
	Weight      float64
	WeightBasis sql.NullString
	Label       sql.NullString
	ObservedAt  sql.NullTime
}
