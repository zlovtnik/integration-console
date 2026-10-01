package reporting

import (
	"time"
)

const (
	InvestigationDefaultNodes = 200
	InvestigationDefaultEdges = 400
	InvestigationDefaultRows  = 50

	// Frame subtypes that are only exchanged with an AP a station is joining,
	// leaving or has joined. Probe and beacon frames are deliberately absent:
	// they observe an AP without evidencing association.
	associationFrameSubtypes = "'association_request','association_response'," +
		"'reassociation_request','reassociation_response'," +
		"'authentication','disassociation','deauthentication'"
)

type InvestigationAnchor struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

type InvestigationRequest struct {
	Anchor         InvestigationAnchor `json:"anchor"`
	APBSSID        string              `json:"ap_bssid,omitempty"`
	DeviceMAC      string              `json:"device_mac,omitempty"`
	LocationIDs    []string            `json:"location_ids,omitempty"`
	SensorIDs      []string            `json:"sensor_ids,omitempty"`
	SSID           string              `json:"ssid,omitempty"` // Kept for shared URL scope; summaries intentionally do not persist raw SSIDs.
	ObservedAfter  *time.Time          `json:"observed_after,omitempty"`
	ObservedBefore *time.Time          `json:"observed_before,omitempty"`
	NodeLimit      int                 `json:"node_limit,omitempty"`
	EdgeLimit      int                 `json:"edge_limit,omitempty"`
	EvidencePage   int                 `json:"evidence_page,omitempty"`
	EvidenceSize   int                 `json:"evidence_page_size,omitempty"`
}

type InvestigationEvidence struct {
	Reference       string    `json:"reference"`
	WindowStart     time.Time `json:"window_start"`
	SensorID        string    `json:"sensor_id"`
	LocationID      string    `json:"location_id,omitempty"`
	BSSID           string    `json:"bssid"`
	DeviceMAC       string    `json:"device_mac"`
	FrameCount      int       `json:"frame_count"`
	RSSIAvgDBM      *float64  `json:"rssi_avg_dbm,omitempty"`
	RSSIMinDBM      *int      `json:"rssi_min_dbm,omitempty"`
	RSSIMaxDBM      *int      `json:"rssi_max_dbm,omitempty"`
	RSSISampleCount int       `json:"rssi_sample_count"`
	FirstObservedAt time.Time `json:"first_observed_at"`
	LastObservedAt  time.Time `json:"last_observed_at"`
}

type InvestigationResponse struct {
	Anchor           InvestigationAnchor     `json:"anchor"`
	Nodes            []GraphNode             `json:"nodes"`
	Links            []InvestigationLink     `json:"links"`
	Roster           []RosterMember          `json:"roster"`
	Evidence         []InvestigationEvidence `json:"evidence"`
	EvidencePage     int                     `json:"evidence_page"`
	EvidencePageSize int                     `json:"evidence_page_size"`
	EvidenceTotal    int                     `json:"evidence_total"`
	SignalQuality    string                  `json:"signal_quality"`
	Confidence       string                  `json:"confidence"`
	RFProximity      string                  `json:"rf_proximity"`
	Freshness        InvestigationFreshness  `json:"freshness"`
	FocusReason      string                  `json:"focus_reason,omitempty"`
	GeneratedAt      time.Time               `json:"generated_at"`

	rfProximityReason string
}

type InvestigationLink struct {
	ID string `json:"id"`
	// Weight is the numeric strength of the link in whatever unit WeightBasis
	// names, never a probability. Links that carry no numeric evidence leave
	// both empty rather than implying a score.
	Weight      float64  `json:"weight,omitempty"`
	WeightBasis string   `json:"weight_basis,omitempty"`
	Source      string   `json:"source"`
	Target      string   `json:"target"`
	Type        string   `json:"type"`
	Evidence    []string `json:"evidence_references,omitempty"`
	Confidence  string   `json:"confidence"`
	Fresh       bool     `json:"fresh"`
}

type InvestigationFreshness struct {
	SourceWatermark     *time.Time `json:"source_watermark,omitempty"`
	ProjectionWatermark *time.Time `json:"projection_watermark,omitempty"`
	CoverageStatus      string     `json:"coverage_status"`
	CoverageReason      string     `json:"coverage_reason,omitempty"`
}

type rfOverlap struct {
	sensors int
	windows int
}
