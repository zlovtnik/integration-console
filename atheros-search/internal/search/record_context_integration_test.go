package search

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	searchv1 "github.com/zlovtnik/ssl-proxy/services/atheros-search/proto/atheros/search/v1"
)

// These run against the canonical DDL in a Testcontainer. sqlmock cannot catch
// a type or expression error in the record-context SQL: the document_id and
// proxy_device_id casts, the jsonb column reads, the time-bucket expression and
// the neighbour CTE are all only exercised here.

func reportingSeedRecordContext(t *testing.T) (context.Context, *Service, time.Time) {
	t.Helper()
	db := reportingDB(t)
	ctx := context.Background()
	observed := time.Date(2026, 3, 4, 9, 15, 0, 0, time.UTC)
	_, err := db.Exec(`TRUNCATE atheros_search.embeddings, atheros_search.embedding_jobs,
  atheros_search.wireless_signal_summaries, atheros_search.devices,
  atheros_search.asset_annotations, atheros_search.graph_edges,
  atheros_search.search_documents CASCADE;

  INSERT INTO atheros_search.search_documents
  (document_id, source_id, source_key, source_table, source_kind, source_mac, bssid, ssid,
   location_id, sensor_id, observed_at, frame_subtype, security_flags, handshake_captured,
   title, normalized_text, normalized_sha256, search_vector, detail_json, tags, metadata,
   proxy_device_id, classification, proxy_event_type)
  VALUES
  ('11111111-1111-1111-1111-111111111111','ctx-frame','ctx-frame','wireless_frames','event',
   'aa:bb:cc:dd:ee:01','aa:bb:cc:dd:ee:ff','lab-ssid','london-lab','sensor-north','2026-03-04T09:15:00Z','data',2,true,
   'Data frame','normalized text', repeat('a',64), to_tsvector('simple','normalized'),
   '{"event_type":"data","sequence_tokens":["assoc","auth"]}','["threat:probe"]','{"producer":"octopus"}',
   '22222222-2222-2222-2222-222222222222','unknown',''),
  ('33333333-3333-3333-3333-333333333333','ctx-proxy','ctx-proxy','proxy_events','proxy_event',
   NULL,NULL,NULL,'london-lab','proxy','2026-03-04T09:15:00Z','',0,false,
   'Blocked tracker','normalized proxy text', repeat('b',64), to_tsvector('simple','proxy'),
   '{}','[]','{"producer":"ssl-proxy"}',NULL,'ads_tracker','http_proxied');

  INSERT INTO atheros_search.embedding_jobs
  (job_id, document_id, embedding_kind, embedding_model, content_sha256, status,
   attempt_count, max_attempts, last_error, completed_at)
  VALUES
  ('55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111','event','text-embed-v1',repeat('a',64),'completed',1,5,'','2026-03-04T09:15:00Z'),
  ('66666666-6666-6666-6666-666666666666','11111111-1111-1111-1111-111111111111','device','text-embed-v1',repeat('a',64),'failed',5,5,
   'backend refused payload',NULL);

  INSERT INTO atheros_search.embeddings
  (document_id, embedding_kind, embedding_model, content_sha256, embedded_at, embedding)
  VALUES ('11111111-1111-1111-1111-111111111111','event','text-embed-v1',repeat('a',64),
   '2026-03-04T09:15:00Z',(ARRAY[1::real] || array_fill(0::real, ARRAY[767]))::public.vector);

  INSERT INTO atheros_search.devices(mac, display_name, first_seen, last_seen)
  VALUES ('aa:bb:cc:dd:ee:01','Laptop','2026-03-04','2026-03-04'),
         ('aa:bb:cc:dd:ee:02','Phone','2026-03-04','2026-03-04'),
         ('aa:bb:cc:dd:ee:03','Elsewhere AP device','2026-03-04','2026-03-04');

  -- A second AP in the same window. Any scope that forgets the anchor must pull
  -- this device in, so its presence is the regression guard for scoping.
  INSERT INTO atheros_search.wireless_signal_summaries
  (window_start, sensor_id, location_id, bssid, source_mac, frame_count,
   rssi_sample_count, rssi_min_dbm, rssi_max_dbm, rssi_avg_dbm, first_observed_at, last_observed_at)
  SELECT base - (w * interval '5 minutes'), 'sensor-north', 'london-lab', 'aa:bb:cc:dd:ee:ab',
         'aa:bb:cc:dd:ee:03', 20, 4, -70, -40, -55.0,
         base - (w * interval '5 minutes') + interval '1 minute',
         base - (w * interval '5 minutes') + interval '4 minutes'
  FROM generate_series(1,6) w, (VALUES ('2026-03-04T09:15:00Z'::timestamptz)) AS b(base);

  INSERT INTO atheros_search.wireless_signal_summaries
  (window_start, sensor_id, location_id, bssid, source_mac, frame_count,
   rssi_sample_count, rssi_min_dbm, rssi_max_dbm, rssi_avg_dbm, first_observed_at, last_observed_at)
  SELECT base - (w * interval '5 minutes'), 'sensor-north', 'london-lab', 'aa:bb:cc:dd:ee:ff',
         src, 20, 4, -70, -40, -55.0, base - (w * interval '5 minutes') + interval '1 minute',
         base - (w * interval '5 minutes') + interval '4 minutes'
  FROM (VALUES ('aa:bb:cc:dd:ee:01'),('aa:bb:cc:dd:ee:02')) AS s(src),
       generate_series(1,6) w, (VALUES ('2026-03-04T09:15:00Z'::timestamptz)) AS b(base);`)
	require.NoError(t, err)
	return ctx, &Service{Pool: db}, observed
}

func TestReportingRecordContextDeviceAnchor(t *testing.T) {
	ctx, svc, observed := reportingSeedRecordContext(t)

	response, err := svc.RecordContext(ctx, RecordContextRequest{SourceKey: "ctx-frame"})
	require.NoError(t, err)
	require.True(t, response.Found)
	require.NotNil(t, response.Record)

	// The record projection reads every column type it advertises.
	record := response.Record
	require.Equal(t, "11111111-1111-1111-1111-111111111111", record.DocumentID)
	require.Equal(t, "ctx-frame", record.SourceKey)
	require.Equal(t, "wireless_frames", record.SourceTable)
	require.Equal(t, "event", record.SourceKind)
	require.Equal(t, "active", record.Status)
	require.Equal(t, "aa:bb:cc:dd:ee:01", record.SourceMAC)
	require.Equal(t, "aa:bb:cc:dd:ee:ff", record.BSSID)
	require.Equal(t, "lab-ssid", record.SSID)
	require.Equal(t, "london-lab", record.LocationID)
	require.Equal(t, "sensor-north", record.SensorID)
	require.Equal(t, "data", record.FrameSubtype)
	require.Equal(t, "octopus", record.Producer)
	require.Equal(t, "Data frame", record.Title)
	require.Equal(t, 2, record.SecurityFlags)
	require.True(t, record.Handshake)
	require.Equal(t, []string{"threat:probe"}, record.Tags)
	require.Equal(t, "22222222-2222-2222-2222-222222222222", record.ProxyDeviceID)
	require.Len(t, record.NormalizedSHA, 64)
	require.Nil(t, record.Blocked)
	require.NotNil(t, record.ObservedAt)
	require.Equal(t, observed, record.ObservedAt.UTC())
	require.Equal(t, []string{"assoc", "auth"}, record.SequenceTokens)
	require.Contains(t, record.DetailJSON, `"event_type": "data"`)

	// The window is anchored on the record, not on now.
	require.Equal(t, observed.Add(time.Minute), response.WindowEnd.UTC())
	require.Equal(t, observed.Add(time.Minute).Add(-24*time.Hour), response.WindowStart.UTC())
	require.Equal(t, 15, response.BucketMinutes)

	// Six five-minute summaries per device collapse into 15-minute buckets.
	require.NotEmpty(t, response.Activity)
	require.Equal(t, 120, response.ActivityTotal.FrameCount)
	require.Equal(t, 2, response.ActivityTotal.Buckets, "30 minutes of 5-minute windows is two 15-minute buckets")
	for _, bucket := range response.Activity {
		require.Equal(t, 0, bucket.WindowStart.Minute()%15, "buckets align to the grain")
		require.Greater(t, bucket.FramesPerMin, 0.0)
	}

	// The peer device shared every retained window on the same AP and sensor.
	require.NotNil(t, response.Related)
	require.Equal(t, "device", response.Related.AnchorKind)
	require.Len(t, response.Related.Neighbours, 1)
	peer := response.Related.Neighbours[0]
	require.Equal(t, "aa:bb:cc:dd:ee:02", peer.MAC)
	require.Equal(t, "Phone", peer.Label)
	require.Equal(t, 6, peer.WindowCount)
	require.Equal(t, 1, peer.SensorCount)
	require.False(t, peer.Qualifies, "one sensor cannot corroborate proximity")
	require.NotNil(t, peer.RSSIAvgDBM)

	// A device on a different AP in the same window is outside the anchor's
	// neighbourhood and must not appear in any part of the related context.
	for _, neighbour := range response.Related.Neighbours {
		require.NotEqual(t, "aa:bb:cc:dd:ee:03", neighbour.MAC)
	}
	for _, link := range response.Related.Links {
		require.NotContains(t, link.From, "aa:bb:cc:dd:ee:03")
		require.NotContains(t, link.To, "aa:bb:cc:dd:ee:03")
		require.NotContains(t, link.From, "aa:bb:cc:dd:ee:ab")
		require.NotContains(t, link.To, "aa:bb:cc:dd:ee:ab")
	}

	// Proximity stays unknown below the two-sensor floor.
	require.Equal(t, "unknown", response.Related.RFProximity)
	var sawPeer bool
	for _, link := range response.Related.Links {
		if link.Type == "inferred_rf_similarity" {
			sawPeer = true
		}
	}
	require.False(t, sawPeer, "a single-sensor overlap is not a proximity claim")

	// The anchor's own AP context is still reported.
	var sawAP bool
	for _, link := range response.Related.Links {
		if link.Type == "observed_ap_context" {
			sawAP = true
			require.Equal(t, "frame_count", link.WeightBasis)
			require.Positive(t, link.Weight)
		}
	}
	require.True(t, sawAP)

	// Embedding work: the completed job is current, the failed one is not, and
	// the lease capability never appears in the payload.
	require.Len(t, response.Embedding, 2)
	byKind := map[string]EmbeddingWork{}
	for _, work := range response.Embedding {
		byKind[work.EmbeddingKind] = work
		require.NotEmpty(t, work.EmbeddingModel)
	}
	require.Equal(t, "completed", byKind["event"].Status)
	require.True(t, byKind["event"].HasVector)
	require.True(t, byKind["event"].ContentCurrent)
	require.Equal(t, "failed", byKind["device"].Status)
	require.False(t, byKind["device"].HasVector)
	require.False(t, byKind["device"].ContentCurrent)
	require.Equal(t, "backend refused payload", byKind["device"].LastError)
	require.Equal(t, 5, byKind["device"].MaxAttempts)
}

func TestReportingRecordContextProxyRecordHasNoNeighbourhood(t *testing.T) {
	ctx, svc, _ := reportingSeedRecordContext(t)

	response, err := svc.RecordContext(ctx, RecordContextRequest{
		SourceKey: "ctx-proxy",
		Kind:      searchv1.SearchKind_SEARCH_KIND_PROXY_EVENT,
	})
	require.NoError(t, err)
	require.True(t, response.Found)
	require.Nil(t, response.Related)
	require.NotEmpty(t, response.RelatedReason)
	require.Empty(t, response.Activity)
	require.NotNil(t, response.Activity)
	require.Equal(t, "ads_tracker", response.Record.Classification)
	require.Equal(t, "http_proxied", response.Record.ProxyEventType)
}

func TestReportingRecordContextApAnchorListsDevices(t *testing.T) {
	ctx, svc, _ := reportingSeedRecordContext(t)
	db := svc.Pool
	// A device document anchored on the AP answers the AP-side question: which
	// identifiers were seen there.
	_, err := db.Exec(`INSERT INTO atheros_search.search_documents
  (document_id, source_id, source_key, source_table, source_kind, bssid, location_id, sensor_id,
   observed_at, normalized_text, normalized_sha256, search_vector)
  VALUES ('44444444-4444-4444-4444-444444444444','ctx-ap','ctx-ap','wireless_frames','event',
  'aa:bb:cc:dd:ee:ff','london-lab','sensor-north','2026-03-04T09:15:00Z','ap text',repeat('c',64),
  to_tsvector('simple','ap'))`)
	require.NoError(t, err)

	response, err := svc.RecordContext(ctx, RecordContextRequest{SourceKey: "ctx-ap"})
	require.NoError(t, err)
	require.NotNil(t, response.Related)
	require.Equal(t, "ap", response.Related.AnchorKind)
	require.Len(t, response.Related.Neighbours, 2)
	macs := map[string]bool{}
	for _, peer := range response.Related.Neighbours {
		macs[peer.MAC] = true
		require.NotZero(t, peer.FrameCount)
	}
	require.True(t, macs["aa:bb:cc:dd:ee:01"])
	require.True(t, macs["aa:bb:cc:dd:ee:02"])
	// The device on the other AP in the same window is out of scope.
	require.False(t, macs["aa:bb:cc:dd:ee:03"])
	require.NotEmpty(t, response.Activity, "an AP anchor still reports wire activity")
	require.Equal(t, 240, response.ActivityTotal.FrameCount,
		"both devices on the anchored AP contribute, the other AP does not")
}

func TestReportingRecordContextMissingDocument(t *testing.T) {
	ctx, svc, _ := reportingSeedRecordContext(t)
	response, err := svc.RecordContext(ctx, RecordContextRequest{SourceKey: "ctx-absent"})
	require.NoError(t, err)
	require.False(t, response.Found)
	require.Nil(t, response.Record)
	require.Nil(t, response.Related)
	require.Empty(t, response.Embedding)
}

func TestReportingScopedExplainCarriesTheRecord(t *testing.T) {
	ctx, svc, _ := reportingSeedRecordContext(t)
	details, err := svc.ExplainScoped(ctx, ScopedExplainRequest{
		SourceKey: "ctx-frame",
		Query:     "normalized",
		Kind:      searchv1.SearchKind_SEARCH_KIND_EVENT,
	})
	require.NoError(t, err)
	require.True(t, details.Found)
	require.True(t, details.ScoresAvailable)
	require.Equal(t, "scoped_sparse_direct", details.RankingMethod)
	// The detail payload the page used to echo back as a score blob is now the
	// stored record payload.
	require.Contains(t, details.DetailJSON, `"event_type": "data"`)
	require.NotNil(t, details.Record)
	require.Equal(t, "aa:bb:cc:dd:ee:01", details.Record.SourceMAC)
	require.Equal(t, []string{"assoc", "auth"}, details.SequenceTokens)
}
