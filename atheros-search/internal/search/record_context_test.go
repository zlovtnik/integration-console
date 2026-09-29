package search

import (
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

// resolveColumns mirrors the projection in resolveDocument. A mismatch fails
// loudly in sqlmock rather than silently drifting, which is why the test keeps
// its own copy instead of exporting the production column list.
func resolveColumns() []string {
	return []string{
		"document_id", "source_id", "source_table", "source_kind", "status",
		"source_mac", "bssid", "ssid", "location_id", "sensor_id", "frame_subtype",
		"classification", "title", "producer", "tags", "security_flags",
		"handshake_captured", "host", "blocked", "proxy_event_type", "proxy_device_id",
		"observed_at", "window_start", "window_end", "normalized_sha256", "detail_json",
	}
}

func resolvedRows(sourceKey, kind string, observedAt time.Time) *sqlmock.Rows {
	return sqlmock.NewRows(resolveColumns()).
		AddRow(
			"11111111-2222-3333-4444-555555555555", sourceKey, "wireless_frames", kind, "active",
			"aa:bb:cc:dd:ee:01", "aa:bb:cc:dd:ee:ff", "lab-ssid", "london-lab", "sensor-north",
			"beacon", "unknown", "Probe from lab device", "octopus",
			[]byte(`["threat:probe"]`), 4, false, "", nil, "", "",
			observedAt, nil, nil, "abc123", `{"event_type":"probe"}`,
		)
}

func emptyResolvedRows() *sqlmock.Rows {
	return sqlmock.NewRows(resolveColumns())
}

func TestResolveDocumentReadsTheWholeRecord(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()
	svc := &Service{Pool: database}
	observed := time.Date(2026, 3, 4, 9, 15, 0, 0, time.UTC)

	mock.ExpectQuery("FROM atheros_search.search_documents").
		WithArgs("frame-key", "event").
		WillReturnRows(resolvedRows("frame-key", "event", observed))

	document, err := svc.resolveDocument(t.Context(), "frame-key", []string{"event"}, nil)
	require.NoError(t, err)
	require.NotNil(t, document)
	require.Equal(t, "11111111-2222-3333-4444-555555555555", document.DocumentID)
	require.Equal(t, "frame-key", document.Fields.SourceKey)
	require.Equal(t, "aa:bb:cc:dd:ee:01", document.Fields.SourceMAC)
	require.Equal(t, "london-lab", document.Fields.LocationID)
	require.Equal(t, "sensor-north", document.Fields.SensorID)
	require.Equal(t, "beacon", document.Fields.FrameSubtype)
	require.Equal(t, "octopus", document.Fields.Producer)
	require.Equal(t, 4, document.Fields.SecurityFlags)
	require.Equal(t, []string{"threat:probe"}, document.Fields.Tags)
	require.Equal(t, "abc123", document.Fields.NormalizedSHA)
	require.Equal(t, `{"event_type":"probe"}`, document.Fields.DetailJSON)
	require.NotNil(t, document.Fields.ObservedAt)
	require.Equal(t, observed, document.Fields.ObservedAt.UTC())
	require.Nil(t, document.Fields.Blocked)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestResolveDocumentExtractsSequenceTokens(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()
	svc := &Service{Pool: database}

	rows := sqlmock.NewRows(resolveColumns()).
		AddRow(
			"doc-1", "seq-key", "frame_sequences", "frame_sequence", "active",
			"aa:bb:cc:dd:ee:01", "", "", "lab", "sensor",
			"data", "", "Sequence", "octopus", []byte(`[]`), 0, false, "", nil, "", "",
			time.Now().UTC(), time.Now().UTC(), time.Now().UTC(), "sha", `{"sequence_tokens":["assoc","auth","data"]}`,
		)
	mock.ExpectQuery("FROM atheros_search.search_documents").WillReturnRows(rows)

	document, err := svc.resolveDocument(t.Context(), "seq-key", []string{"frame_sequence"}, nil)
	require.NoError(t, err)
	require.Equal(t, []string{"assoc", "auth", "data"}, document.Fields.SequenceTokens)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestResolveDocumentMissingRow(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()
	svc := &Service{Pool: database}

	mock.ExpectQuery("FROM atheros_search.search_documents").WillReturnRows(emptyResolvedRows())
	document, err := svc.resolveDocument(t.Context(), "gone", []string{"event"}, nil)
	require.NoError(t, err)
	require.Nil(t, document)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRecordFieldsAnchorPrefersDeviceMAC(t *testing.T) {
	device, id := RecordFields{SourceMAC: "aa:bb:cc:dd:ee:01", BSSID: "aa:bb:cc:dd:ee:ff"}.anchor()
	require.Equal(t, "device", device)
	require.Equal(t, "aa:bb:cc:dd:ee:01", id)

	ap, apID := RecordFields{BSSID: "aa:bb:cc:dd:ee:ff"}.anchor()
	require.Equal(t, "ap", ap)
	require.Equal(t, "aa:bb:cc:dd:ee:ff", apID)

	kind, none := RecordFields{SourceMAC: "not-a-mac", BSSID: "also-bad"}.anchor()
	require.Equal(t, "", kind)
	require.Equal(t, "", none)
}

func TestRecordContextRejectsBlankSourceKey(t *testing.T) {
	svc := &Service{}
	_, err := svc.RecordContext(t.Context(), RecordContextRequest{SourceKey: "   "})
	require.EqualError(t, err, "source_key is required")
}

func TestRecordContextMissingRecordIsNotAnError(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()
	svc := &Service{Pool: database}

	mock.ExpectQuery("FROM atheros_search.search_documents").WillReturnRows(emptyResolvedRows())
	response, err := svc.RecordContext(t.Context(), RecordContextRequest{SourceKey: "gone"})
	require.NoError(t, err)
	require.False(t, response.Found)
	require.Nil(t, response.Record)
	require.NotNil(t, response.Activity)
	require.NotNil(t, response.Embedding)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRecordContextWithoutAnchorExplainsItself(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()
	svc := &Service{Pool: database}
	observed := time.Date(2026, 3, 4, 9, 15, 0, 0, time.UTC)

	rows := sqlmock.NewRows(resolveColumns()).
		AddRow(
			"doc-proxy", "proxy-key", "proxy_events", "proxy_event", "active",
			"", "", "", "lab", "proxy", "", "ads_tracker", "Blocked host", "ssl-proxy",
			[]byte(`[]`), 0, false, "tracker.example", true, "http_proxied", "11111111-1111-1111-1111-111111111111",
			observed, nil, nil, "sha", `{}`,
		)
	mock.ExpectQuery("FROM atheros_search.search_documents").WillReturnRows(rows)
	mock.ExpectBegin()
	mock.ExpectQuery("FROM atheros_search.investigation_watermarks").
		WillReturnRows(sqlmock.NewRows([]string{"source_watermark_at", "projection_watermark_at", "coverage_status", "coverage_reason"}))
	mock.ExpectQuery("FROM atheros_search.embedding_jobs").
		WillReturnRows(sqlmock.NewRows([]string{
			"embedding_kind", "embedding_model", "status", "attempt_count", "max_attempts",
			"next_attempt_at", "last_error", "completed_at", "embedded_at", "content_sha256", "has_vector",
		}))
	mock.ExpectCommit()

	response, err := svc.RecordContext(t.Context(), RecordContextRequest{SourceKey: "proxy-key"})
	require.NoError(t, err)
	require.True(t, response.Found)
	require.Nil(t, response.Related)
	require.NotEmpty(t, response.RelatedReason)
	require.NotNil(t, response.Record.Blocked)
	require.True(t, *response.Record.Blocked)
	require.Equal(t, "ads_tracker", response.Record.Classification)
	// The window follows the record so a historical event is not reported as
	// having no activity merely because the default window ends now.
	require.Equal(t, observed.Add(time.Minute), response.WindowEnd.UTC())
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRecordContextLoadsActivityAndEmbedding(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()
	svc := &Service{Pool: database}
	observed := time.Date(2026, 3, 4, 9, 15, 0, 0, time.UTC)
	windowEnd := observed.Add(time.Minute)
	windowStart := windowEnd.Add(-24 * time.Hour)

	rows := sqlmock.NewRows(resolveColumns()).
		AddRow(
			"doc-1", "frame-key", "wireless_frames", "event", "active",
			"aa:bb:cc:dd:ee:01", "aa:bb:cc:dd:ee:ff", "lab", "lab", "sensor-north",
			"data", "unknown", "Data frame", "octopus", []byte(`[]`), 2, true, "", nil, "", "",
			observed, nil, nil, "sha-1", `{}`,
		)
	mock.ExpectQuery("FROM atheros_search.search_documents").WillReturnRows(rows)
	mock.ExpectBegin()
	mock.ExpectQuery("FROM atheros_search.investigation_watermarks").
		WillReturnRows(sqlmock.NewRows([]string{"source_watermark_at", "projection_watermark_at", "coverage_status", "coverage_reason"}))
	mock.ExpectQuery("FROM atheros_search.wireless_signal_summaries").
		WithArgs(windowStart, windowEnd, "aa:bb:cc:dd:ee:01").
		WillReturnRows(sqlmock.NewRows([]string{"bucket", "frames", "sensors", "aps", "rssi", "first", "last"}).
			AddRow(observed.Add(-30*time.Minute), 60, 2, 1, -55.0, observed.Add(-40*time.Minute), observed.Add(-25*time.Minute)).
			AddRow(observed.Add(-15*time.Minute), 10, 1, 1, nil, observed.Add(-20*time.Minute), observed.Add(-10*time.Minute)))
	mock.ExpectQuery("FROM atheros_search.wireless_signal_summaries").
		WithArgs(windowStart, windowEnd, "aa:bb:cc:dd:ee:01", 200).
		WillReturnRows(sqlmock.NewRows([]string{"bssid", "source_mac", "frames", "first", "last", "sensors", "label", "pinned"}).
			AddRow("aa:bb:cc:dd:ee:ff", "aa:bb:cc:dd:ee:01", 70, observed.Add(-40*time.Minute), observed.Add(-10*time.Minute), 2, "laptop", false))
	mock.ExpectQuery("FROM atheros_search.search_documents").
		WillReturnRows(sqlmock.NewRows([]string{"source_mac", "bssid", "frame_count", "last_seen", "handshake"}))
	mock.ExpectQuery("FROM atheros_search.graph_edges").
		WillReturnRows(sqlmock.NewRows([]string{"edge_id", "source_node_id", "target_node_id", "observed_at"}))
	mock.ExpectQuery("WITH anchor AS").
		WithArgs("aa:bb:cc:dd:ee:01", windowStart, windowEnd, 100).
		WillReturnRows(sqlmock.NewRows([]string{"source_mac", "label", "windows", "sensors", "aps", "frames", "rssi", "first", "last"}).
			AddRow("aa:bb:cc:dd:ee:02", "phone", 4, 2, 1, 90, -61.0, observed.Add(-50*time.Minute), observed.Add(-5*time.Minute)))
	mock.ExpectQuery("FROM atheros_search.embedding_jobs").
		WithArgs("doc-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"embedding_kind", "embedding_model", "status", "attempt_count", "max_attempts",
			"next_attempt_at", "last_error", "completed_at", "embedded_at", "content_sha256", "has_vector",
		}).
			AddRow("event", "text-embed-v1", "completed", 1, 5, nil, "", observed, observed, "sha-1", true).
			AddRow("device", "text-embed-v1", "failed", 5, 5, observed.Add(time.Hour), "backend refused payload", nil, nil, "sha-1", false))
	mock.ExpectCommit()

	response, err := svc.RecordContext(t.Context(), RecordContextRequest{SourceKey: "frame-key"})
	require.NoError(t, err)
	require.True(t, response.Found)
	require.Equal(t, 15, response.BucketMinutes)
	require.Len(t, response.Activity, 2)
	require.Equal(t, 70, response.ActivityTotal.FrameCount)
	// 60 frames across a 15-minute bucket is 4 frames per minute.
	require.Equal(t, 4.0, response.Activity[0].FramesPerMin)
	require.Equal(t, 4.0, response.ActivityTotal.PeakFrameRate)
	require.Equal(t, 2, response.ActivityTotal.SensorCount)
	require.NotNil(t, response.Activity[0].RSSIAvgDBM)
	require.Nil(t, response.Activity[1].RSSIAvgDBM)

	require.NotNil(t, response.Related)
	require.Equal(t, "device", response.Related.AnchorKind)
	require.Equal(t, "aa:bb:cc:dd:ee:01", response.Related.AnchorID)
	require.Len(t, response.Related.Neighbours, 1)
	require.Equal(t, "phone", response.Related.Neighbours[0].Label)
	require.True(t, response.Related.Neighbours[0].Qualifies)
	require.Equal(t, 4, response.Related.Neighbours[0].WindowCount)
	require.Equal(t, 2, response.Related.Neighbours[0].SensorCount)
	require.Equal(t, "inferred", response.Related.RFProximity)
	// The peer link is synthesised from the co-observation query because the
	// device-anchored pair query has only the anchor device to compare. The
	// roster separately contributes the anchor's own AP context.
	var rfLink *Communication
	for i := range response.Related.Links {
		if response.Related.Links[i].Type == "inferred_rf_similarity" {
			rfLink = &response.Related.Links[i]
		}
	}
	require.NotNil(t, rfLink, "expected a device-to-device proximity link")
	require.Equal(t, "device:aa:bb:cc:dd:ee:01", rfLink.From)
	require.Equal(t, "device:aa:bb:cc:dd:ee:02", rfLink.To)
	require.Equal(t, 4.0, rfLink.Weight)
	require.Equal(t, "time_overlap_windows", rfLink.WeightBasis)
	var apLink *Communication
	for i := range response.Related.Links {
		if response.Related.Links[i].Type == "observed_ap_context" {
			apLink = &response.Related.Links[i]
		}
	}
	require.NotNil(t, apLink, "expected the anchor's own AP context link")
	require.Equal(t, 70.0, apLink.Weight)
	require.Equal(t, "frame_count", apLink.WeightBasis)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestEmbeddingWorkContentCurrentRequiresMatchingHash(t *testing.T) {
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()
	svc := &Service{Pool: database}
	observed := time.Date(2026, 3, 4, 9, 15, 0, 0, time.UTC)
	windowEnd := observed.Add(time.Minute)
	windowStart := windowEnd.Add(-24 * time.Hour)

	rows := sqlmock.NewRows(resolveColumns()).
		AddRow(
			"doc-1", "frame-key", "wireless_frames", "event", "active",
			"aa:bb:cc:dd:ee:01", "", "", "lab", "sensor", "data", "", "Frame", "octopus",
			[]byte(`[]`), 0, false, "", nil, "", "", observed, nil, nil, "live-sha", `{}`,
		)
	mock.ExpectQuery("FROM atheros_search.search_documents").WillReturnRows(rows)
	mock.ExpectBegin()
	mock.ExpectQuery("FROM atheros_search.investigation_watermarks").
		WillReturnRows(sqlmock.NewRows([]string{"source_watermark_at", "projection_watermark_at", "coverage_status", "coverage_reason"}))
	mock.ExpectQuery("FROM atheros_search.wireless_signal_summaries").
		WithArgs(windowStart, windowEnd, "aa:bb:cc:dd:ee:01").
		WillReturnRows(sqlmock.NewRows([]string{"bucket", "frames", "sensors", "aps", "rssi", "first", "last"}))
	mock.ExpectQuery("FROM atheros_search.wireless_signal_summaries").
		WillReturnRows(sqlmock.NewRows([]string{"bssid", "source_mac", "frames", "first", "last", "sensors", "label", "pinned"}))
	// With no roster rows there are no nodes, so the association, identity and
	// RF-similarity link builders all short-circuit before issuing SQL.
	mock.ExpectQuery("WITH anchor AS").
		WithArgs("aa:bb:cc:dd:ee:01", windowStart, windowEnd, 100).
		WillReturnRows(sqlmock.NewRows([]string{"source_mac", "label", "windows", "sensors", "aps", "frames", "rssi", "first", "last"}))
	mock.ExpectQuery("FROM atheros_search.embedding_jobs").
		WithArgs("doc-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"embedding_kind", "embedding_model", "status", "attempt_count", "max_attempts",
			"next_attempt_at", "last_error", "completed_at", "embedded_at", "content_sha256", "has_vector",
		}).
			AddRow("event", "m1", "completed", 1, 5, nil, "", observed, observed, "stale-sha", true).
			AddRow("device", "m1", "failed", 5, 5, nil, "backend refused", nil, nil, "live-sha", false))
	mock.ExpectCommit()

	response, err := svc.RecordContext(t.Context(), RecordContextRequest{SourceKey: "frame-key"})
	require.NoError(t, err)
	require.Len(t, response.Embedding, 2)
	require.False(t, response.Embedding[0].ContentCurrent, "a stale content hash is not current even with a stored vector")
	require.Equal(t, "completed", response.Embedding[0].Status)
	require.False(t, response.Embedding[1].ContentCurrent, "no vector means the job is not embedded")
	require.Equal(t, "backend refused", response.Embedding[1].LastError)
	require.Equal(t, 5, response.Embedding[1].MaxAttempts)
	require.NoError(t, mock.ExpectationsWereMet())
}
