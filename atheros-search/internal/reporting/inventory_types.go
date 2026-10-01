package reporting

import (
	"time"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/reportmeta"
)

const (
	inventoryDefaultLimit = 400
	inventoryMaxLimit     = 1000
)

type InventoryGrouping string

const (
	InventoryGroupingRegistry   InventoryGrouping = "registry"
	InventoryGroupingCMDB       InventoryGrouping = "cmdb"
	InventoryGroupingSimilarity InventoryGrouping = "similarity"
)

type InventoryNodeKind string

const (
	InventoryNodeDevice         InventoryNodeKind = "device"
	InventoryNodeOwner          InventoryNodeKind = "owner"
	InventoryNodeLocationAsset  InventoryNodeKind = "location_asset"
	InventoryNodeCluster        InventoryNodeKind = "cluster"
	InventoryNodeMergeCandidate InventoryNodeKind = "merge_candidate"
)

type InventoryEdgeKind string

const (
	InventoryEdgeOwns           InventoryEdgeKind = "owns"
	InventoryEdgeLocatedAt      InventoryEdgeKind = "located_at"
	InventoryEdgeClusterMember  InventoryEdgeKind = "cluster_member"
	InventoryEdgeMergeCandidate InventoryEdgeKind = "merge_candidate"
	InventoryEdgeSameDevice     InventoryEdgeKind = "same_device"
	InventoryEdgeCandidatePair  InventoryEdgeKind = "candidate_pair"
)

type InventoryFilters struct {
	Registered          *bool             `json:"registered,omitempty"`
	NeedsIdentityReview bool              `json:"needs_identity_review,omitempty"`
	Query               string            `json:"query,omitempty"`
	SourceMACs          []string          `json:"source_macs,omitempty"`
	SensorIDs           []string          `json:"sensor_ids,omitempty"`
	ObservedAfter       *time.Time        `json:"observed_after,omitempty"`
	ObservedBefore      *time.Time        `json:"observed_before,omitempty"`
	Sort                string            `json:"sort,omitempty"`
	Grouping            InventoryGrouping `json:"grouping"`
	LocationIDs         []string          `json:"location_ids,omitempty"`
	OwnerIDs            []string          `json:"owner_ids,omitempty"`
	ActiveOnly          bool              `json:"active_only,omitempty"`
	MinDedupConfidence  *float64          `json:"min_dedup_confidence,omitempty"`
	Tags                []string          `json:"tags,omitempty"`
	Limit               int               `json:"limit,omitempty"`
	Scope               string            `json:"scope,omitempty"`
	PageCursor          string            `json:"page_cursor,omitempty"`
	PageSize            int               `json:"page_size,omitempty"`
}

type InventoryNode struct {
	Registered          *bool             `json:"registered,omitempty"`
	FirstSeen           *time.Time        `json:"first_seen,omitempty"`
	PendingReviewCount  *int              `json:"pending_review_count,omitempty"`
	NoAPLink            *bool             `json:"no_ap_link_in_projection,omitempty"`
	ID                  string            `json:"id"`
	Kind                InventoryNodeKind `json:"kind"`
	Label               string            `json:"label"`
	MAC                 string            `json:"mac,omitempty"`
	KnownMACs           []string          `json:"known_macs,omitempty"`
	DisplayName         string            `json:"display_name,omitempty"`
	OwnerID             string            `json:"owner_id,omitempty"`
	LocationID          string            `json:"location_id,omitempty"`
	FirstRegistered     *time.Time        `json:"first_registered,omitempty"`
	LastSeen            *time.Time        `json:"last_seen,omitempty"`
	Active              bool              `json:"active"`
	SimilarityClusterID string            `json:"similarity_cluster_id,omitempty"`
	DedupConfidence     *float64          `json:"dedup_confidence,omitempty"`
	Tags                []string          `json:"tags,omitempty"`
}

type InventoryEdge struct {
	ID     string            `json:"id"`
	Source string            `json:"source"`
	Target string            `json:"target"`
	Kind   InventoryEdgeKind `json:"kind"`
	Weight *float64          `json:"weight,omitempty"`
}

type InventoryResponse struct {
	Report               *reportmeta.Metadata `json:"report,omitempty"`
	Nodes                []InventoryNode      `json:"nodes"`
	Edges                []InventoryEdge      `json:"edges"`
	GeneratedAt          time.Time            `json:"generated_at"`
	NodeCount            int                  `json:"node_count"`
	EdgeCount            int                  `json:"edge_count"`
	TotalRegisteredCount int                  `json:"total_registered_count"`
	NextPageCursor       string               `json:"next_page_cursor,omitempty"`
	TotalNodeCount       *int                 `json:"total_node_count,omitempty"`
	TotalEdgeCount       *int                 `json:"total_edge_count,omitempty"`
	TotalDeviceCount     *int                 `json:"total_device_count,omitempty"`
}

type inventoryDeviceRow struct {
	MAC             string
	DisplayName     string
	OwnerID         string
	LocationID      string
	FirstRegistered *time.Time
	LastSeen        *time.Time
	Active          bool
	Registered      bool
	Tags            []string
	KnownMACs       []string
}

type pendingInventoryCandidate struct {
	id         string
	macA       string
	macB       string
	confidence float64
}
