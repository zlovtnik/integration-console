package operations

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"
)

const upstreamTimeout = 2 * time.Second
const maxSnapshotBytes = 1 << 20

// snapshotReader shares bounded reads across users without letting a cancelled
// browser request cancel another user's refresh. The URL is configuration only;
// no request headers, credentials, query parameters or redirects are forwarded.
type snapshotReader struct {
	url         string
	ttl         time.Duration
	client      *http.Client
	now         func() time.Time
	mu          sync.Mutex
	nextAttempt time.Time
	refreshDone chan struct{}
	cached      []byte
	validate    func([]byte) bool
}

func newSnapshotReader(url string, ttl time.Duration, validate func([]byte) bool) *snapshotReader {
	return &snapshotReader{url: url, ttl: ttl, now: time.Now, validate: validate, client: &http.Client{
		Timeout:       upstreamTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

func (s *snapshotReader) read(ctx context.Context) []byte {
	if s.url == "" {
		return nil
	}
	s.mu.Lock()
	if !s.now().Before(s.nextAttempt) && s.refreshDone == nil {
		s.nextAttempt = s.now().Add(s.ttl)
		s.refreshDone = make(chan struct{})
		// #nosec G118 -- Shared two-second refresh must survive individual browser cancellation.
		go s.refresh()
	}
	if s.cached != nil || s.refreshDone == nil {
		cached := s.cached
		s.mu.Unlock()
		return cached
	}
	done := s.refreshDone
	s.mu.Unlock()
	select {
	case <-ctx.Done():
		return nil
	case <-done:
		s.mu.Lock()
		defer s.mu.Unlock()
		return s.cached
	}
}

func (s *snapshotReader) refresh() {
	ctx, cancel := context.WithTimeout(context.Background(), upstreamTimeout)
	defer cancel()
	data, err := s.fetch(ctx)
	s.mu.Lock()
	defer s.mu.Unlock()
	if err == nil && s.validate(data) {
		s.cached = data
	}
	close(s.refreshDone)
	s.refreshDone = nil
}

func (s *snapshotReader) fetch(ctx context.Context) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.url, nil)
	if err != nil {
		return nil, err
	}
	response, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }() // Bounded read is complete; closing a network body is best effort.
	if response.StatusCode != http.StatusOK {
		return nil, errors.New("measurement unavailable")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxSnapshotBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxSnapshotBytes {
		return nil, errors.New("measurement too large")
	}
	return data, nil
}

type Counters struct {
	TunnelsOpened    uint64 `json:"tunnels_opened"`
	BytesUp          uint64 `json:"bytes_up"`
	BytesDown        uint64 `json:"bytes_down"`
	Blocked          uint64 `json:"blocked"`
	Allowed          uint64 `json:"allowed"`
	Obfuscated       uint64 `json:"obfuscated"`
	HostStatsDropped uint64 `json:"host_stats_dropped"`
}

type Classifications struct {
	AdsTracker   uint64 `json:"ads_tracker"`
	Analytics    uint64 `json:"analytics"`
	CDN          uint64 `json:"cdn"`
	EssentialAPI uint64 `json:"essential_api"`
	Auth         uint64 `json:"auth"`
	Unknown      uint64 `json:"unknown"`
}

type Publisher struct {
	Configured           bool       `json:"configured"`
	Status               string     `json:"status"`
	QueueDepth           uint64     `json:"queue_depth"`
	QueueCapacity        uint64     `json:"queue_capacity"`
	SpooledTotal         uint64     `json:"spooled_total"`
	EnqueueTimeoutsTotal uint64     `json:"enqueue_timeouts_total"`
	LastAttemptAt        *time.Time `json:"last_attempt_at"`
	LastPublishAt        *time.Time `json:"last_publish_at"`
}

type proxySnapshot struct {
	SchemaVersion   int              `json:"schema_version"`
	MeasuredAt      time.Time        `json:"measured_at"`
	InstanceID      string           `json:"instance_id"`
	ActiveTunnels   *uint64          `json:"active_tunnels"`
	Counters        *Counters        `json:"counters"`
	Classifications *Classifications `json:"classifications"`
	Publisher       *Publisher       `json:"publisher"`
}

type Rates struct {
	TunnelsPerSecond   float64 `json:"tunnels_per_second"`
	BytesUpPerSecond   float64 `json:"bytes_up_per_second"`
	BytesDownPerSecond float64 `json:"bytes_down_per_second"`
}

type ProxyLive struct {
	Scope           string           `json:"scope"`
	Status          string           `json:"status"`
	MeasuredAt      *time.Time       `json:"measured_at"`
	ActiveTunnels   *uint64          `json:"active_tunnels"`
	Counters        *Counters        `json:"counters"`
	Classifications *Classifications `json:"classifications"`
	Publisher       *Publisher       `json:"publisher"`
	Rates           *Rates           `json:"rates"`
}

type proxyReader struct {
	reader *snapshotReader
	mu     sync.Mutex
	last   *proxySnapshot
	rates  *Rates
}

func newProxyReader(url string) *proxyReader {
	s := &proxyReader{}
	s.reader = newSnapshotReader(url, 5*time.Second, func(data []byte) bool {
		var snapshot proxySnapshot
		if json.Unmarshal(data, &snapshot) != nil || !validProxy(snapshot, s.reader.now()) || !completeProxy(data) {
			return false
		}
		s.observe(snapshot)
		return true
	})
	return s
}

func completeProxy(data []byte) bool {
	var fields map[string]json.RawMessage
	if json.Unmarshal(data, &fields) != nil {
		return false
	}
	return requiredFields(fields["counters"], []string{"tunnels_opened", "bytes_up", "bytes_down", "blocked", "allowed", "obfuscated", "host_stats_dropped"}) &&
		requiredFields(fields["classifications"], []string{"ads_tracker", "analytics", "cdn", "essential_api", "auth", "unknown"}) &&
		requiredFields(fields["publisher"], []string{"configured", "status", "queue_depth", "queue_capacity", "spooled_total", "enqueue_timeouts_total"})
}

func requiredFields(data []byte, keys []string) bool {
	var fields map[string]json.RawMessage
	if json.Unmarshal(data, &fields) != nil {
		return false
	}
	for _, key := range keys {
		if len(fields[key]) == 0 || bytes.Equal(bytes.TrimSpace(fields[key]), []byte("null")) {
			return false
		}
	}
	return true
}

func validProxy(snapshot proxySnapshot, now time.Time) bool {
	if snapshot.SchemaVersion != 1 || snapshot.MeasuredAt.IsZero() || snapshot.MeasuredAt.After(now.Add(time.Second)) || len(snapshot.InstanceID) < 1 || len(snapshot.InstanceID) > 128 || snapshot.ActiveTunnels == nil || snapshot.Counters == nil || snapshot.Classifications == nil || snapshot.Publisher == nil {
		return false
	}
	switch snapshot.Publisher.Status {
	case "disabled", "pending", "ok", "degraded":
		return true
	}
	return false
}

func (s *proxyReader) read(ctx context.Context) ProxyLive {
	result := ProxyLive{Scope: "global", Status: "unavailable"}
	if s.reader.url == "" {
		result.Status = "disabled"
		return result
	}
	data := s.reader.read(ctx)
	var snapshot proxySnapshot
	if json.Unmarshal(data, &snapshot) != nil {
		return result
	}
	now := s.reader.now()
	result.MeasuredAt = &snapshot.MeasuredAt
	if now.Sub(snapshot.MeasuredAt) > 60*time.Second {
		return result
	}
	result.Status = measurementStatus(snapshot.MeasuredAt, now, 15*time.Second)
	result.ActiveTunnels, result.Counters, result.Classifications, result.Publisher = snapshot.ActiveTunnels, snapshot.Counters, snapshot.Classifications, snapshot.Publisher
	s.mu.Lock()
	defer s.mu.Unlock()
	if result.Status == "current" && s.last != nil && s.last.InstanceID == snapshot.InstanceID && s.last.MeasuredAt.Equal(snapshot.MeasuredAt) {
		result.Rates = s.rates
	}
	return result
}

// observe runs only during the shared serialized refresh. Browser readers
// never advance or rewind the sampling baseline, regardless of scheduling.
func (s *proxyReader) observe(snapshot proxySnapshot) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.last != nil && snapshot.InstanceID == s.last.InstanceID && !snapshot.MeasuredAt.After(s.last.MeasuredAt) {
		return
	}
	s.rates = nil
	if s.last != nil && s.last.InstanceID == snapshot.InstanceID && countersIncrease(*s.last.Counters, *snapshot.Counters) {
		seconds := snapshot.MeasuredAt.Sub(s.last.MeasuredAt).Seconds()
		s.rates = &Rates{TunnelsPerSecond: float64(snapshot.Counters.TunnelsOpened-s.last.Counters.TunnelsOpened) / seconds, BytesUpPerSecond: float64(snapshot.Counters.BytesUp-s.last.Counters.BytesUp) / seconds, BytesDownPerSecond: float64(snapshot.Counters.BytesDown-s.last.Counters.BytesDown) / seconds}
	}
	s.last = &snapshot
}

func countersIncrease(previous, current Counters) bool {
	return current.TunnelsOpened >= previous.TunnelsOpened && current.BytesUp >= previous.BytesUp && current.BytesDown >= previous.BytesDown && current.Blocked >= previous.Blocked && current.Allowed >= previous.Allowed && current.Obfuscated >= previous.Obfuscated && current.HostStatsDropped >= previous.HostStatsDropped
}

type SeriesPoint struct {
	BucketStart time.Time `json:"bucket_start"`
	Records     int64     `json:"records"`
}
type Throughput struct {
	Bucket string        `json:"bucket"`
	Series []SeriesPoint `json:"series"`
}
type History struct {
	Status          string      `json:"status"`
	AsOf            *time.Time  `json:"as_of"`
	PeaksStatus     string      `json:"peaks_status"`
	PeaksComputedAt *time.Time  `json:"peaks_computed_at"`
	PeakRecordsDay  *int64      `json:"peak_records_day"`
	PeakRecordsWeek *int64      `json:"peak_records_week"`
	LiveStrip       *LiveStrip  `json:"live_strip"`
	Throughput24h   *Throughput `json:"throughput_24h"`
	Throughput7d    *Throughput `json:"throughput_7d"`
}
type LiveStrip struct {
	IngestProcessedRatePerSec *float64   `json:"ingest_processed_rate_per_sec"`
	PendingLedgerCount        *int64     `json:"pending_ledger_count"`
	BrokerLagCount            *int64     `json:"broker_lag_count"`
	LastIngestSuccessAt       *time.Time `json:"last_ingest_success_at"`
	BackpressureActive        *bool      `json:"backpressure_active"`
}
type statsSnapshot struct {
	AsOf            time.Time  `json:"asOf"`
	PeaksComputedAt *time.Time `json:"peaksComputedAt"`
	PeakRecordsDay  *int64     `json:"peakRecordsDay"`
	PeakRecordsWeek *int64     `json:"peakRecordsWeek"`
	LiveStrip       *struct {
		IngestProcessedRatePerSec *float64   `json:"ingestProcessedRatePerSec"`
		PendingLedgerCount        *int64     `json:"pendingLedgerCount"`
		BrokerLagCount            *int64     `json:"brokerLagCount"`
		LastIngestSuccessAt       *time.Time `json:"lastIngestSuccessAt"`
		BackpressureActive        *bool      `json:"backpressureActive"`
	} `json:"liveStrip"`
	Throughput24h *statsThroughput `json:"throughput24h"`
	Throughput7d  *statsThroughput `json:"throughput7d"`
}
type statsThroughput struct {
	Bucket string `json:"bucket"`
	Series []struct {
		BucketStart time.Time `json:"bucketStart"`
		Records     int64     `json:"records"`
	} `json:"series"`
}
type statsReader struct{ reader *snapshotReader }

func newStatsReader(url string) *statsReader {
	s := &statsReader{}
	s.reader = newSnapshotReader(url, 30*time.Second, func(data []byte) bool {
		var snapshot statsSnapshot
		return json.Unmarshal(data, &snapshot) == nil && measurementStatus(snapshot.AsOf, s.reader.now(), 180*time.Second) != "unavailable"
	})
	return s
}
func (s *statsReader) read(ctx context.Context) History {
	result := History{Status: "unavailable", PeaksStatus: "unavailable"}
	var snapshot statsSnapshot
	if json.Unmarshal(s.reader.read(ctx), &snapshot) != nil {
		return result
	}
	result.AsOf, result.PeaksComputedAt = &snapshot.AsOf, snapshot.PeaksComputedAt
	result.Status = measurementStatus(snapshot.AsOf, s.reader.now(), 180*time.Second)
	if result.Status == "current" && snapshot.LiveStrip != nil {
		strip := snapshot.LiveStrip
		result.LiveStrip = &LiveStrip{strip.IngestProcessedRatePerSec, strip.PendingLedgerCount, strip.BrokerLagCount, strip.LastIngestSuccessAt, strip.BackpressureActive}
	}
	if snapshot.PeaksComputedAt != nil {
		result.PeaksStatus = measurementStatus(*snapshot.PeaksComputedAt, s.reader.now(), 360*time.Second)
		if result.PeaksStatus == "current" {
			result.PeakRecordsDay, result.PeakRecordsWeek = snapshot.PeakRecordsDay, snapshot.PeakRecordsWeek
		}
	}
	// Bucketed history retains its source timestamps independently of live
	// freshness. It must be labeled historical by consumers.
	result.Throughput24h, result.Throughput7d = mapThroughput(snapshot.Throughput24h), mapThroughput(snapshot.Throughput7d)
	return result
}
func mapThroughput(input *statsThroughput) *Throughput {
	if input == nil || len(input.Series) > 1000 || (input.Bucket != "hour" && input.Bucket != "day") {
		return nil
	}
	result := &Throughput{Bucket: input.Bucket, Series: []SeriesPoint{}}
	for _, point := range input.Series {
		if point.BucketStart.IsZero() || point.Records < 0 {
			return nil
		}
		result.Series = append(result.Series, SeriesPoint{BucketStart: point.BucketStart, Records: point.Records})
	}
	return result
}
