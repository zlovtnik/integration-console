package operations

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func proxyFixture(t *testing.T, measured time.Time, instance string, value uint64) []byte {
	t.Helper()
	active := uint64(2)
	data, err := json.Marshal(proxySnapshot{SchemaVersion: 1, MeasuredAt: measured, InstanceID: instance, ActiveTunnels: &active, Counters: &Counters{TunnelsOpened: value, BytesUp: value * 10, BytesDown: value * 100}, Classifications: &Classifications{}, Publisher: &Publisher{Status: "pending", Configured: true}})
	require.NoError(t, err)
	return data
}

func waitRefresh(t *testing.T, reader *snapshotReader) {
	t.Helper()
	reader.mu.Lock()
	done := reader.refreshDone
	reader.mu.Unlock()
	if done != nil {
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Fatal("refresh did not finish")
		}
	}
}

func TestProxySharedCacheAndReaderIndependentRates(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	var clock atomic.Int64
	clock.Store(now.UnixNano())
	var calls atomic.Uint64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Error("browser identity must not be sent upstream")
		}
		_, _ = w.Write(proxyFixture(t, time.Unix(0, clock.Load()), "instance-a", uint64(calls.Load()*10)))
	}))
	t.Cleanup(server.Close)
	reader := newProxyReader(server.URL)
	reader.reader.now = func() time.Time { return time.Unix(0, clock.Load()) }
	require.Nil(t, reader.read(t.Context()).Rates)
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			result := reader.read(t.Context())
			if result.Status != "current" || result.Rates != nil {
				t.Error("shared first sample must have no rates")
			}
		}()
	}
	wg.Wait()
	require.Equal(t, uint64(1), calls.Load())
	clock.Store(now.Add(6 * time.Second).UnixNano())
	_ = reader.read(t.Context()) // Stale-while-refresh returns the previous cache.
	waitRefresh(t, reader.reader)
	result := reader.read(t.Context())
	require.NotNil(t, result.Rates)
	require.InDelta(t, 100.0/6, result.Rates.BytesUpPerSecond, 0.0001)
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			result := reader.read(t.Context())
			if result.Rates == nil || result.Rates.BytesUpPerSecond < 16 {
				t.Error("one reader must not consume another reader's rate")
			}
		}()
	}
	wg.Wait()
	require.Equal(t, uint64(2), calls.Load())
	// An older read completing later cannot rewind the baseline.
	var old proxySnapshot
	require.NoError(t, json.Unmarshal(proxyFixture(t, now, "instance-a", 10), &old))
	reader.observe(old)
	require.True(t, now.Add(6*time.Second).Equal(reader.last.MeasuredAt))
	require.NotNil(t, reader.read(t.Context()).Rates)
}

func TestProxyRatesUnavailableOnCounterResetOrProcessChange(t *testing.T) {
	now := time.Now().UTC()
	reader := newProxyReader("")
	for _, sample := range []struct {
		instance string
		value    uint64
		rate     bool
	}{{"a", 10, false}, {"a", 20, true}, {"a", 1, false}, {"b", 50, false}, {"b", 60, true}} {
		var snapshot proxySnapshot
		require.NoError(t, json.Unmarshal(proxyFixture(t, now, sample.instance, sample.value), &snapshot))
		reader.observe(snapshot)
		require.Equal(t, sample.rate, reader.rates != nil)
		now = now.Add(time.Second)
	}
}

func TestProxyFreshnessRetainsMeasuredTimeAndHidesUnavailableCounters(t *testing.T) {
	now := time.Now().UTC()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(proxyFixture(t, now, "a", 10)) }))
	t.Cleanup(server.Close)
	reader := newProxyReader(server.URL)
	reader.reader.now = func() time.Time { return now }
	require.Equal(t, "current", reader.read(t.Context()).Status)
	reader.reader.now = func() time.Time { return now.Add(16 * time.Second) }
	stale := reader.read(t.Context())
	require.Equal(t, "stale", stale.Status)
	require.NotNil(t, stale.Counters)
	require.Nil(t, stale.Rates)
	waitRefresh(t, reader.reader)
	reader.reader.now = func() time.Time { return now.Add(61 * time.Second) }
	unavailable := reader.read(t.Context())
	require.Equal(t, "unavailable", unavailable.Status)
	require.Equal(t, now, *unavailable.MeasuredAt)
	require.Nil(t, unavailable.Counters)
	waitRefresh(t, reader.reader)
	reader.reader.now = func() time.Time { return now.Add(61 * time.Second) }
}

func TestCancellationDoesNotCancelSharedRefresh(t *testing.T) {
	now := time.Now().UTC()
	started, release := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(started)
		<-release
		_, _ = w.Write(proxyFixture(t, now, "a", 10))
	}))
	t.Cleanup(server.Close)
	reader := newProxyReader(server.URL)
	ctx, cancel := context.WithCancel(t.Context())
	first := make(chan ProxyLive, 1)
	go func() { first <- reader.read(ctx) }()
	<-started
	cancel()
	require.Equal(t, "unavailable", (<-first).Status)
	second := make(chan ProxyLive, 1)
	go func() { second <- reader.read(t.Context()) }()
	close(release)
	require.Equal(t, "current", (<-second).Status)
}

func TestProxyRejectsPartialFutureAndUnsafeResponses(t *testing.T) {
	now := time.Now().UTC()
	valid := proxyFixture(t, now, "a", 10)
	var partial map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(valid, &partial))
	partial["counters"] = json.RawMessage(`{"bytes_up":1}`)
	partialData, err := json.Marshal(partial)
	require.NoError(t, err)
	for _, body := range [][]byte{[]byte(`{"error":"private upstream path"}`), partialData, proxyFixture(t, now.Add(time.Minute), "a", 10)} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(body) }))
		reader := newProxyReader(server.URL)
		result := reader.read(t.Context())
		require.Equal(t, "unavailable", result.Status)
		require.Nil(t, result.Counters)
		server.Close()
	}
	// Unknown upstream fields are dropped at every object boundary.
	var extra map[string]any
	require.NoError(t, json.Unmarshal(valid, &extra))
	extra["peer_address"] = "private-peer"
	extra["publisher"].(map[string]any)["error"] = "private-upstream-error"
	body, err := json.Marshal(extra)
	require.NoError(t, err)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(body) }))
	t.Cleanup(server.Close)
	result := newProxyReader(server.URL).read(t.Context())
	encoded, err := json.Marshal(result)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "private-")
	require.NotContains(t, string(encoded), "instance_id")
}

func TestUpstreamTimeoutRedirectAndBodyBounds(t *testing.T) {
	reader := newProxyReader("http://127.0.0.1:1")
	require.Equal(t, 2*time.Second, reader.reader.client.Timeout)
	for _, mode := range []string{"timeout", "redirect", "large", "status"} {
		t.Run(mode, func(t *testing.T) {
			var redirected atomic.Int64
			target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { redirected.Add(1) }))
			t.Cleanup(target.Close)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch mode {
				case "timeout":
					<-r.Context().Done()
				case "redirect":
					http.Redirect(w, r, target.URL, http.StatusFound)
				case "large":
					_, _ = w.Write(make([]byte, maxSnapshotBytes+1))
				case "status":
					http.Error(w, "private error", 500)
				}
			}))
			t.Cleanup(server.Close)
			reader := newProxyReader(server.URL)
			reader.reader.client.Timeout = 20 * time.Millisecond
			result := reader.read(t.Context())
			require.Equal(t, "unavailable", result.Status)
			require.Nil(t, result.Counters)
			require.Zero(t, redirected.Load())
		})
	}
}

func TestMaterializedStatsPreserveIndependentFreshnessAndHistory(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	var clock atomic.Int64
	clock.Store(now.UnixNano())
	body := map[string]any{"asOf": now, "peaksComputedAt": now.Add(-200 * time.Second), "peakRecordsDay": 12, "peakRecordsWeek": 80, "liveStrip": map[string]any{"ingestProcessedRatePerSec": 5.5, "backpressureActive": false, "private": "secret"}, "throughput24h": map[string]any{"bucket": "hour", "series": []map[string]any{{"bucketStart": now.Add(-time.Hour), "records": 15, "private": "secret"}}}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _ = json.NewEncoder(w).Encode(body) }))
	t.Cleanup(server.Close)
	reader := newStatsReader(server.URL)
	reader.reader.now = func() time.Time { return time.Unix(0, clock.Load()) }
	current := reader.read(t.Context())
	require.Equal(t, "current", current.Status)
	require.Equal(t, "current", current.PeaksStatus)
	require.Equal(t, int64(12), *current.PeakRecordsDay)
	require.NotNil(t, current.LiveStrip)
	require.Nil(t, current.LiveStrip.PendingLedgerCount, "missing measurements stay null")
	clock.Store(now.Add(181 * time.Second).UnixNano())
	stale := reader.read(t.Context())
	require.Equal(t, "stale", stale.Status)
	require.Equal(t, "stale", stale.PeaksStatus)
	require.Nil(t, stale.LiveStrip)
	require.Nil(t, stale.PeakRecordsDay)
	require.Len(t, stale.Throughput24h.Series, 1, "history survives stale live measurements with original bucket time")
	encoded, err := json.Marshal(stale)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "secret")
	waitRefresh(t, reader.reader)
}
