package search

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	searchv1 "github.com/zlovtnik/ssl-proxy/services/atheros-search/proto/atheros/search/v1"
)

const (
	RecordContextDefaultWindow  = 24 * time.Hour
	RecordContextMaxWindow      = 7 * 24 * time.Hour
	RecordContextDefaultBuckets = 15
	recordContextMaxBuckets     = 24 * 60
	recordContextNeighbourLimit = 100
)

// RecordFields is the stored document itself: identity, place, time and kind.
// It answers "what am I actually looking at", which the ranking envelope on its
// own never carried.
type RecordFields struct {
	DocumentID     string     `json:"document_id"`
	SourceKey      string     `json:"source_key"`
	SourceTable    string     `json:"source_table"`
	SourceKind     string     `json:"source_kind"`
	Status         string     `json:"status"`
	SourceMAC      string     `json:"source_mac"`
	BSSID          string     `json:"bssid"`
	SSID           string     `json:"ssid"`
	LocationID     string     `json:"location_id"`
	SensorID       string     `json:"sensor_id"`
	FrameSubtype   string     `json:"frame_subtype"`
	Classification string     `json:"classification"`
	Title          string     `json:"title"`
	Producer       string     `json:"producer"`
	Tags           []string   `json:"tags"`
	SecurityFlags  int        `json:"security_flags"`
	Handshake      bool       `json:"handshake_captured"`
	Host           string     `json:"host"`
	Blocked        *bool      `json:"blocked"`
	ProxyEventType string     `json:"proxy_event_type"`
	ProxyDeviceID  string     `json:"proxy_device_id"`
	ObservedAt     *time.Time `json:"observed_at"`
	WindowStart    *time.Time `json:"window_start"`
	WindowEnd      *time.Time `json:"window_end"`
	NormalizedSHA  string     `json:"normalized_sha256"`
	DetailJSON     string     `json:"detail_json"`
	SequenceTokens []string   `json:"sequence_tokens,omitempty"`
}

// anchor returns the identifier an investigation can be focused on. A record
// with neither a device MAC nor an AP BSSID has no neighbourhood to report,
// which is surfaced as unavailable rather than as an empty result.
func (f RecordFields) anchor() (kind, id string) {
	if macPattern.MatchString(f.SourceMAC) {
		return "device", f.SourceMAC
	}
	if macPattern.MatchString(f.BSSID) {
		return "ap", f.BSSID
	}
	return "", ""
}

// ActivityBucket is one time slice of observed traffic for the anchored
// identifier. FramesPerMin normalises the bucket width so a quiet hour and a
// burst are comparable without the reader doing arithmetic.
type ActivityBucket struct {
	WindowStart  time.Time  `json:"window_start"`
	FrameCount   int        `json:"frame_count"`
	FramesPerMin float64    `json:"frames_per_minute"`
	SensorCount  int        `json:"sensor_count"`
	APCount      int        `json:"ap_count"`
	RSSIAvgDBM   *float64   `json:"rssi_avg_dbm,omitempty"`
	FirstSeen    *time.Time `json:"first_observed_at,omitempty"`
	LastSeen     *time.Time `json:"last_observed_at,omitempty"`
}

type ActivityTotals struct {
	Buckets       int        `json:"buckets"`
	FrameCount    int        `json:"frame_count"`
	FramesPerMin  float64    `json:"frames_per_minute"`
	PeakFrameRate float64    `json:"peak_frames_per_minute"`
	PeakWindow    *time.Time `json:"peak_window,omitempty"`
	SensorCount   int        `json:"sensor_count"`
	APCount       int        `json:"ap_count"`
	FirstSeen     *time.Time `json:"first_observed_at,omitempty"`
	LastSeen      *time.Time `json:"last_observed_at,omitempty"`
}

// Communication is one relationship in the anchored identifier's neighbourhood.
// Weight and WeightBasis are carried verbatim from the projection so the UI
// never re-describes how a weight was derived. A weight is an evidence count,
// never a probability.
type Communication struct {
	Type        string   `json:"type"`
	From        string   `json:"from"`
	To          string   `json:"to"`
	Weight      float64  `json:"weight,omitempty"`
	WeightBasis string   `json:"weight_basis,omitempty"`
	Confidence  string   `json:"confidence,omitempty"`
	Fresh       bool     `json:"fresh"`
	Evidence    []string `json:"evidence_references,omitempty"`
}

// Neighbour is another observed identifier sharing retained sensor windows
// with the anchor. WindowCount and SensorCount are the tempo of the overlap:
// how many five-minute windows, corroborated across how many sensors.
type Neighbour struct {
	MAC         string    `json:"mac"`
	Label       string    `json:"label"`
	APCount     int       `json:"ap_count"`
	WindowCount int       `json:"window_count"`
	SensorCount int       `json:"sensor_count"`
	FrameCount  int       `json:"frame_count"`
	RSSIAvgDBM  *float64  `json:"rssi_avg_dbm,omitempty"`
	FirstSeen   time.Time `json:"first_observed_at"`
	LastSeen    time.Time `json:"last_observed_at"`
	Qualifies   bool      `json:"corroborated"`
}

type RelatedContext struct {
	AnchorKind    string          `json:"anchor_kind"`
	AnchorID      string          `json:"anchor_id"`
	Neighbours    []Neighbour     `json:"neighbours"`
	Links         []Communication `json:"links"`
	RFProximity   string          `json:"rf_proximity"`
	SignalQuality string          `json:"signal_quality"`
	Confidence    string          `json:"confidence"`
	FocusReason   string          `json:"focus_reason,omitempty"`
}

// EmbeddingWork is the embedding state for this exact document: what was asked
// for, what was produced, and whether the vector still matches the live text.
// The lease token and fence are worker write capabilities and are never
// returned.
type EmbeddingWork struct {
	EmbeddingKind  string     `json:"embedding_kind"`
	EmbeddingModel string     `json:"embedding_model"`
	Status         string     `json:"status"`
	AttemptCount   int        `json:"attempt_count"`
	MaxAttempts    int        `json:"max_attempts"`
	NextAttemptAt  *time.Time `json:"next_attempt_at,omitempty"`
	LastError      string     `json:"last_error,omitempty"`
	CompletedAt    *time.Time `json:"completed_at,omitempty"`
	EmbeddedAt     *time.Time `json:"embedded_at,omitempty"`
	ContentSHA     string     `json:"content_sha256,omitempty"`
	HasVector      bool       `json:"has_vector"`
	ContentCurrent bool       `json:"content_current"`
}

type RecordContextRequest struct {
	SourceKey     string
	Kind          searchv1.SearchKind
	Filters       *searchv1.SearchFilters
	Window        time.Duration
	BucketMinutes int
}

type RecordContext struct {
	SourceKey     string                 `json:"source_key"`
	Found         bool                   `json:"found"`
	Record        *RecordFields          `json:"record"`
	WindowStart   time.Time              `json:"window_start"`
	WindowEnd     time.Time              `json:"window_end"`
	BucketMinutes int                    `json:"bucket_minutes"`
	Activity      []ActivityBucket       `json:"activity"`
	ActivityTotal ActivityTotals         `json:"activity_totals"`
	Related       *RelatedContext        `json:"related"`
	RelatedReason string                 `json:"related_unavailable_reason,omitempty"`
	Embedding     []EmbeddingWork        `json:"embedding"`
	EmbeddingNote string                 `json:"embedding_note,omitempty"`
	Freshness     InvestigationFreshness `json:"freshness"`
	GeneratedAt   time.Time              `json:"generated_at"`
}

type resolvedDocument struct {
	DocumentID string
	Fields     RecordFields
}

// resolveDocument is the single resolution path for a source key, so the
// explain handlers and the record context can never disagree about which row a
// key names. The UI's "source_key" is the source_id column; the separately
// backfilled source_key column is not what search results expose.
func (s *Service) resolveDocument(ctx context.Context, sourceKey string, kinds []string, filters *searchv1.SearchFilters) (*resolvedDocument, error) {
	args := []any{sourceKey}
	for _, kind := range kinds {
		args = append(args, kind)
	}
	placeholders := pgPlaceholders(2, len(kinds))
	scope, scopeArgs := documentScopeSQL("d", filters, len(args)+1)
	args = append(args, scopeArgs...)

	var (
		document    resolvedDocument
		tags        []byte
		observedAt  sql.NullTime
		windowStart sql.NullTime
		windowEnd   sql.NullTime
		blocked     sql.NullBool
	)
	err := s.Pool.QueryRowContext(ctx, `SELECT d.document_id::text, d.source_id, COALESCE(d.source_table,''),
 d.source_kind, d.status, COALESCE(d.source_mac,''), COALESCE(d.bssid,''), COALESCE(d.ssid,''),
 COALESCE(d.location_id,''), COALESCE(d.sensor_id,''), COALESCE(d.frame_subtype,''),
 COALESCE(d.classification,''), COALESCE(d.title,''), COALESCE(d.metadata ->> 'producer',''),
 d.tags::text, COALESCE(d.security_flags,0), COALESCE(d.handshake_captured,false),
 COALESCE(d.host,''), d.blocked, COALESCE(d.proxy_event_type,''), COALESCE(CAST(d.proxy_device_id AS TEXT),''),
 d.observed_at, d.window_start, d.window_end, btrim(COALESCE(d.normalized_sha256,'')),
 COALESCE(d.detail_json::text,'{}')
FROM atheros_search.search_documents d
WHERE d.source_id=$1 AND d.source_kind IN (`+placeholders+`) AND d.status='active'`+scope+`
ORDER BY d.source_kind LIMIT 1`, args...).Scan(
		&document.DocumentID, &document.Fields.SourceKey, &document.Fields.SourceTable,
		&document.Fields.SourceKind, &document.Fields.Status, &document.Fields.SourceMAC,
		&document.Fields.BSSID, &document.Fields.SSID, &document.Fields.LocationID,
		&document.Fields.SensorID, &document.Fields.FrameSubtype, &document.Fields.Classification,
		&document.Fields.Title, &document.Fields.Producer, &tags,
		&document.Fields.SecurityFlags, &document.Fields.Handshake, &document.Fields.Host,
		&blocked, &document.Fields.ProxyEventType, &document.Fields.ProxyDeviceID,
		&observedAt, &windowStart, &windowEnd, &document.Fields.NormalizedSHA,
		&document.Fields.DetailJSON,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	document.Fields.ObservedAt = nullTimePtr(observedAt)
	document.Fields.WindowStart = nullTimePtr(windowStart)
	document.Fields.WindowEnd = nullTimePtr(windowEnd)
	document.Fields.DocumentID = document.DocumentID
	if blocked.Valid {
		value := blocked.Bool
		document.Fields.Blocked = &value
	}
	document.Fields.Tags = decodeStringList(tags)
	document.Fields.SequenceTokens = sequenceTokensFromDetail(document.Fields.DetailJSON)
	return &document, nil
}

func decodeStringList(raw []byte) []string {
	if len(raw) == 0 {
		return []string{}
	}
	var values []string
	if err := json.Unmarshal(raw, &values); err != nil {
		return []string{}
	}
	if values == nil {
		return []string{}
	}
	return values
}

// sequenceTokensFromDetail reads the frame_sequence token list out of the stored
// detail payload. The token list has no dedicated column, and inventing one
// would duplicate a field the coordinator already writes.
func sequenceTokensFromDetail(detailJSON string) []string {
	if strings.TrimSpace(detailJSON) == "" {
		return nil
	}
	var payload struct {
		SequenceTokens []string `json:"sequence_tokens"`
	}
	if err := json.Unmarshal([]byte(detailJSON), &payload); err != nil {
		return nil
	}
	return payload.SequenceTokens
}

// RecordContext assembles the investigation view of one record: stored fields,
// observed rate over time, the neighbourhood of the anchored identifier, and
// the embedding work behind this exact document.
func (s *Service) RecordContext(ctx context.Context, req RecordContextRequest) (*RecordContext, error) {
	sourceKey := strings.TrimSpace(req.SourceKey)
	if sourceKey == "" {
		return nil, errors.New("source_key is required")
	}
	kinds, err := requestKinds(req.Kind)
	if err != nil {
		return nil, err
	}
	window := req.Window
	if window <= 0 {
		window = RecordContextDefaultWindow
	}
	if window > RecordContextMaxWindow {
		window = RecordContextMaxWindow
	}
	bucket := req.BucketMinutes
	if bucket <= 0 {
		bucket = RecordContextDefaultBuckets
	}
	if bucket > recordContextMaxBuckets {
		bucket = recordContextMaxBuckets
	}

	document, err := s.resolveDocument(ctx, sourceKey, kinds, req.Filters)
	if err != nil {
		return nil, err
	}
	generatedAt := time.Now().UTC()
	windowEnd := generatedAt
	windowStart := generatedAt.Add(-window)
	// Anchor the window on the record when it has a timestamp, so a historical
	// record is not reported as having no activity merely because the default
	// window ends now.
	if document != nil && document.Fields.ObservedAt != nil {
		windowEnd = document.Fields.ObservedAt.UTC().Add(time.Minute)
		windowStart = windowEnd.Add(-window)
	}

	response := &RecordContext{
		SourceKey:     sourceKey,
		Found:         document != nil,
		WindowStart:   windowStart,
		WindowEnd:     windowEnd,
		BucketMinutes: bucket,
		Activity:      []ActivityBucket{},
		Embedding:     []EmbeddingWork{},
		GeneratedAt:   generatedAt,
	}
	if document == nil {
		return response, nil
	}
	response.Record = &document.Fields
	response.EmbeddingNote = embeddingContractNote(document.Fields.NormalizedSHA)

	tx, err := s.Pool.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	freshness, err := investigationWatermarks(ctx, tx)
	if err != nil {
		return nil, err
	}
	response.Freshness = freshness

	anchorKind, anchorID := document.Fields.anchor()
	switch {
	case anchorKind == "":
		response.RelatedReason = "This record carries no device MAC and no AP BSSID, so the evidence projection has no neighbourhood to report for it."
	default:
		if err := s.loadRecordActivity(ctx, tx, anchorKind, anchorID, windowStart, windowEnd, bucket, response); err != nil {
			return nil, err
		}
		related, err := s.loadRecordRelated(ctx, tx, anchorKind, anchorID, windowStart, windowEnd, generatedAt)
		if err != nil {
			return nil, err
		}
		response.Related = related
	}
	if err := s.loadRecordEmbedding(ctx, tx, document.DocumentID, document.Fields.NormalizedSHA, response); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return response, nil
}

func embeddingContractNote(documentSHA string) string {
	if strings.TrimSpace(documentSHA) == "" {
		return "This document has no content hash, so embedding freshness cannot be compared."
	}
	return "content_current is true only when a stored vector exists, the job completed, and the job content hash matches the live document hash."
}

func (s *Service) loadRecordActivity(ctx context.Context, tx *sql.Tx, anchorKind, anchorID string, windowStart, windowEnd time.Time, bucketMinutes int, response *RecordContext) error {
	// A device anchor is one station's traffic. An AP anchor is the whole
	// traffic of the network segment that AP serves, so it aggregates over every
	// source MAC on that BSSID rather than filtering to a single transmitter.
	clauses := []string{"summary.window_start >= $1", "summary.window_start < $2"}
	args := []any{windowStart, windowEnd}
	column := "summary.source_mac"
	if anchorKind == "ap" {
		column = "summary.bssid"
	}
	clauses = append([]string{column + "=$3"}, clauses...)
	args = append(args, anchorID)
	// Floor to an absolute bucket boundary on the epoch, so a bucket of N
	// minutes groups the same instants regardless of the five-minute alignment
	// the summary grain guarantees. Modulo would not floor: for a 15-minute
	// bucket it leaves 09:00, 09:05 and 09:10 as three separate buckets.
	seconds := bucketMinutes * 60
	bucketExpr := `to_timestamp(FLOOR(EXTRACT(EPOCH FROM summary.window_start) / ` +
		fmt.Sprint(seconds) + `) * ` + fmt.Sprint(seconds) + `)`
	rows, err := tx.QueryContext(ctx, `SELECT `+bucketExpr+` AS bucket,
 SUM(summary.frame_count), COUNT(DISTINCT summary.sensor_id), COUNT(DISTINCT summary.bssid),
 AVG(summary.rssi_avg_dbm), MIN(summary.first_observed_at), MAX(summary.last_observed_at)
FROM atheros_search.wireless_signal_summaries summary
WHERE `+strings.Join(clauses, " AND ")+`
GROUP BY 1 ORDER BY 1 ASC`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	minutes := float64(bucketMinutes)
	for rows.Next() {
		var item ActivityBucket
		var rssi sql.NullFloat64
		if err := rows.Scan(&item.WindowStart, &item.FrameCount, &item.SensorCount, &item.APCount, &rssi, &item.FirstSeen, &item.LastSeen); err != nil {
			return err
		}
		item.WindowStart = item.WindowStart.UTC()
		item.FramesPerMin = round2(float64(item.FrameCount) / minutes)
		if rssi.Valid {
			value := rssi.Float64
			item.RSSIAvgDBM = &value
		}
		response.Activity = append(response.Activity, item)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	totals := &response.ActivityTotal
	totals.Buckets = len(response.Activity)
	peakSensors, peakAPs := 0, 0
	for i := range response.Activity {
		item := response.Activity[i]
		totals.FrameCount += item.FrameCount
		if item.FramesPerMin > totals.PeakFrameRate {
			totals.PeakFrameRate = item.FramesPerMin
			peak := item.WindowStart
			totals.PeakWindow = &peak
		}
		if item.SensorCount > peakSensors {
			peakSensors = item.SensorCount
		}
		if item.APCount > peakAPs {
			peakAPs = item.APCount
		}
		if totals.FirstSeen == nil || (item.FirstSeen != nil && item.FirstSeen.Before(*totals.FirstSeen)) {
			totals.FirstSeen = item.FirstSeen
		}
		if item.LastSeen != nil && (totals.LastSeen == nil || item.LastSeen.After(*totals.LastSeen)) {
			totals.LastSeen = item.LastSeen
		}
	}
	totals.SensorCount = peakSensors
	totals.APCount = peakAPs
	if totals.Buckets > 0 {
		totals.FramesPerMin = round2(float64(totals.FrameCount) / (minutes * float64(totals.Buckets)))
	}
	return nil
}

func (s *Service) loadRecordRelated(ctx context.Context, tx *sql.Tx, anchorKind, anchorID string, windowStart, windowEnd, generatedAt time.Time) (*RelatedContext, error) {
	// normalizeInvestigationRequest is what maps the anchor onto DeviceMAC or
	// APBSSID. investigationScopeWith reads those fields, not Anchor, so
	// skipping it would scope the roster to the whole window instead of this
	// anchor's neighbourhood.
	request, err := normalizeInvestigationRequest(InvestigationRequest{
		Anchor:         InvestigationAnchor{Kind: anchorKind, ID: anchorID},
		ObservedAfter:  &windowStart,
		ObservedBefore: &windowEnd,
		NodeLimit:      InvestigationDefaultNodes,
		EdgeLimit:      InvestigationDefaultEdges,
		EvidenceSize:   InvestigationDefaultRows,
	})
	if err != nil {
		return nil, err
	}
	scope, args := investigationScope(request, "summary")
	investigation := &InvestigationResponse{
		Anchor:       request.Anchor,
		Nodes:        []GraphNode{},
		Links:        []InvestigationLink{},
		Roster:       []RosterMember{},
		Evidence:     []InvestigationEvidence{},
		RFProximity:  "unknown",
		EvidencePage: 0,
		Freshness:    InvestigationFreshness{CoverageStatus: "unknown"},
		GeneratedAt:  generatedAt,
	}
	freshCutoff := generatedAt.Add(-24 * time.Hour)
	if err := s.investigationRoster(ctx, tx, scope, args, request, investigation, freshCutoff); err != nil {
		return nil, err
	}
	if err := s.investigationAssociationLinks(ctx, tx, request, investigation, freshCutoff); err != nil {
		return nil, err
	}
	if err := s.investigationTypedLinks(ctx, tx, request, investigation, freshCutoff); err != nil {
		return nil, err
	}

	related := &RelatedContext{
		AnchorKind:    anchorKind,
		AnchorID:      anchorID,
		Neighbours:    []Neighbour{},
		Links:         []Communication{},
		RFProximity:   "unknown",
		SignalQuality: "RSSI unavailable",
		Confidence:    "evidence quality is based on retained frame and sensor coverage; it is not a probability or physical distance",
	}
	if anchorKind == "device" {
		// A device anchor scopes the investigation roster to the anchor itself,
		// so the pair-proximity query has a single device to compare and
		// short-circuits. The co-observation query is the only path that yields
		// the anchor's peers, and it carries the same window and sensor counts
		// the pair query would have.
		if err := s.loadRecordNeighbours(ctx, tx, anchorID, windowStart, windowEnd, related); err != nil {
			return nil, err
		}
		for _, peer := range related.Neighbours {
			if !peer.Qualifies {
				continue
			}
			related.RFProximity = "inferred"
			related.Links = append(related.Links, Communication{
				Type:        "inferred_rf_similarity",
				From:        "device:" + anchorID,
				To:          "device:" + peer.MAC,
				Weight:      float64(peer.WindowCount),
				WeightBasis: "time_overlap_windows",
				Confidence:  rfConfidence(peer.SensorCount, peer.WindowCount),
				Fresh:       !peer.LastSeen.Before(freshCutoff),
			})
		}
	} else {
		// An AP anchor yields many devices in the roster, so device-to-device
		// proximity among them is meaningful here.
		if err := s.investigationRFSimilarityLinks(ctx, tx, request, investigation, freshCutoff); err != nil {
			return nil, err
		}
		related.RFProximity = investigation.RFProximity
		for _, member := range investigation.Roster {
			related.Neighbours = append(related.Neighbours, Neighbour{
				MAC:         member.MAC,
				Label:       member.Name,
				WindowCount: 1,
				FrameCount:  member.RecordCount,
				FirstSeen:   member.FirstObserved,
				LastSeen:    member.LastObserved,
			})
		}
	}
	for _, link := range investigation.Links {
		related.Links = append(related.Links, Communication{
			Type:        link.Type,
			From:        link.Source,
			To:          link.Target,
			Weight:      link.Weight,
			WeightBasis: link.WeightBasis,
			Confidence:  link.Confidence,
			Fresh:       link.Fresh,
			Evidence:    link.Evidence,
		})
	}
	// RSSI is only claimed when a retained sample backs it. The evidence page is
	// not loaded on the device path, so the neighbour rows are what carry
	// measured signal there.
	for _, peer := range related.Neighbours {
		if peer.RSSIAvgDBM != nil {
			related.SignalQuality = "sensor-measured RSSI available"
			break
		}
	}
	focus := strings.TrimSpace(investigation.FocusReason + " " + investigation.rfProximityReason)
	if focus != "" {
		related.FocusReason = focus
	}
	return related, nil
}

// loadRecordNeighbours lists identifiers that shared a retained sensor window
// and AP with the anchor device. WindowCount is the tempo of the overlap and
// SensorCount is its corroboration; one sensor alone can only report proximity
// it cannot confirm, so corroboration is reported per row rather than used as a
// filter.
func (s *Service) loadRecordNeighbours(ctx context.Context, tx *sql.Tx, anchorMAC string, windowStart, windowEnd time.Time, related *RelatedContext) error {
	rows, err := tx.QueryContext(ctx, `WITH anchor AS (
  SELECT DISTINCT window_start, sensor_id, bssid
  FROM atheros_search.wireless_signal_summaries
  WHERE source_mac=$1 AND window_start >= $2 AND window_start < $3
)
SELECT peer.source_mac,
 COALESCE(annotation.label, NULLIF(device.display_name,''), peer.source_mac),
 COUNT(DISTINCT shared.window_start),
 COUNT(DISTINCT shared.sensor_id),
 COUNT(DISTINCT shared.bssid),
 SUM(peer.frame_count),
 AVG(peer.rssi_avg_dbm),
 MIN(peer.first_observed_at),
 MAX(peer.last_observed_at)
FROM anchor shared
JOIN atheros_search.wireless_signal_summaries peer
  ON peer.window_start = shared.window_start
 AND peer.sensor_id = shared.sensor_id
 AND peer.bssid = shared.bssid
 AND peer.source_mac <> $1
 AND peer.source_mac ~ '^[0-9a-f]{2}(:[0-9a-f]{2}){5}$'
LEFT JOIN atheros_search.devices device ON device.mac = peer.source_mac
LEFT JOIN atheros_search.asset_annotations annotation
  ON annotation.asset_kind='device' AND annotation.asset_id=peer.source_mac
GROUP BY peer.source_mac, annotation.label, device.display_name
ORDER BY COUNT(DISTINCT shared.window_start) DESC,
         COUNT(DISTINCT shared.sensor_id) DESC,
         SUM(peer.frame_count) DESC,
         peer.source_mac
LIMIT $4`, anchorMAC, windowStart, windowEnd, recordContextNeighbourLimit)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var item Neighbour
		var rssi sql.NullFloat64
		if err := rows.Scan(&item.MAC, &item.Label, &item.WindowCount, &item.SensorCount,
			&item.APCount, &item.FrameCount, &rssi, &item.FirstSeen, &item.LastSeen); err != nil {
			return err
		}
		if rssi.Valid {
			value := rssi.Float64
			item.RSSIAvgDBM = &value
		}
		item.Qualifies = qualifiesRFOverlap(item.SensorCount, item.WindowCount)
		related.Neighbours = append(related.Neighbours, item)
	}
	return rows.Err()
}

func (s *Service) loadRecordEmbedding(ctx context.Context, tx *sql.Tx, documentID, documentSHA string, response *RecordContext) error {
	rows, err := tx.QueryContext(ctx, `SELECT job.embedding_kind, job.embedding_model, job.status,
 COALESCE(job.attempt_count,0), COALESCE(job.max_attempts,0), job.next_attempt_at,
 COALESCE(job.last_error,''), job.completed_at, vector.embedded_at,
 btrim(COALESCE(job.content_sha256,'')), (vector.embedding_id IS NOT NULL) AS has_vector
FROM atheros_search.embedding_jobs job
LEFT JOIN atheros_search.embeddings vector
  ON vector.document_id = job.document_id
 AND vector.embedding_kind = job.embedding_kind
 AND vector.embedding_model = job.embedding_model
WHERE job.document_id = $1
ORDER BY job.embedding_kind ASC, job.embedding_model ASC`, documentID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var item EmbeddingWork
		if err := rows.Scan(&item.EmbeddingKind, &item.EmbeddingModel, &item.Status,
			&item.AttemptCount, &item.MaxAttempts, &item.NextAttemptAt, &item.LastError,
			&item.CompletedAt, &item.EmbeddedAt, &item.ContentSHA, &item.HasVector); err != nil {
			return err
		}
		item.ContentCurrent = item.HasVector &&
			documentSHA != "" &&
			strings.EqualFold(strings.TrimSpace(item.ContentSHA), strings.TrimSpace(documentSHA))
		response.Embedding = append(response.Embedding, item)
	}
	return rows.Err()
}

func round2(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	return math.Round(value*100) / 100
}
