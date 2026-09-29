package metrics

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type Metrics struct {
	SearchRequests     *prometheus.CounterVec
	SearchLatency      *prometheus.HistogramVec
	ResultsReturned    *prometheus.CounterVec
	EmbeddingCacheHits prometheus.Counter
	EmbeddingCacheMiss prometheus.Counter
	SearchFallbacks    *prometheus.CounterVec
	GraphEdgeDensity   *prometheus.GaugeVec
	VectorCoverage     *prometheus.GaugeVec

	EmbeddingBackendAvailable *prometheus.GaugeVec
	EmbeddingCircuitState     *prometheus.GaugeVec
	EmbeddingLimiterInUse     *prometheus.GaugeVec
	EmbeddingLimiterCapacity  *prometheus.GaugeVec
	EmbeddingLimiterWait      *prometheus.HistogramVec
	EmbeddingPreflightState   *prometheus.GaugeVec
	EmbeddingJobs             *prometheus.GaugeVec
	EmbeddingOldestPendingAge prometheus.Gauge
	EmbeddingActiveWorkers    prometheus.Gauge
	SearchableWirelessEvents  prometheus.Gauge
	WirelessNewestObservation prometheus.Gauge
}

func New() *Metrics {
	return NewForRegisterer(prometheus.DefaultRegisterer)
}

func NewForRegisterer(registerer prometheus.Registerer) *Metrics {
	m := &Metrics{
		SearchRequests: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "athsearch_search_requests_total",
			Help: "Search requests by kind, mode, and status.",
		}, []string{"kind", "mode", "status"}),
		SearchLatency: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "athsearch_search_latency_ms",
			Help:    "Search request latency in milliseconds.",
			Buckets: []float64{5, 10, 25, 50, 100, 250, 500, 1000, 2500},
		}, []string{"kind", "mode"}),
		ResultsReturned: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "athsearch_results_returned_total",
			Help: "Search results returned by source kind.",
		}, []string{"kind"}),
		EmbeddingCacheHits: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "athsearch_embedding_cache_hits_total",
			Help: "Query embedding cache hits.",
		}),
		EmbeddingCacheMiss: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "athsearch_embedding_cache_misses_total",
			Help: "Query embedding cache misses.",
		}),
		SearchFallbacks: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "athsearch_search_fallbacks_total",
			Help: "Searches that degraded to keyword-only ranking, by kind and stable fallback code.",
		}, []string{"kind", "code"}),
		GraphEdgeDensity: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "athsearch_graph_edge_density",
			Help: "Edges per graph node by node kind, sampled from graph responses.",
		}, []string{"node_kind"}),
		VectorCoverage: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "athsearch_search_vector_coverage",
			Help: "Embedded vectors per embedding kind; zero indicates a kind with no semantic coverage.",
		}, []string{"embedding_kind"}),
		EmbeddingBackendAvailable: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "athsearch_embedding_backend_available",
			Help: "One when the embedding backend is proven healthy for a lane and its circuit is closed.",
		}, []string{"lane"}),
		EmbeddingCircuitState: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "athsearch_embedding_circuit_state",
			Help: "One for the current embedding circuit state of a lane, zero for the others.",
		}, []string{"lane", "state"}),
		EmbeddingLimiterInUse: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "athsearch_embedding_limiter_in_use",
			Help: "Backend embedding slots currently held by a lane.",
		}, []string{"lane"}),
		EmbeddingLimiterCapacity: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "athsearch_embedding_limiter_capacity",
			Help: "Backend embedding slots a lane is permitted to hold.",
		}, []string{"lane"}),
		EmbeddingLimiterWait: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "athsearch_embedding_limiter_wait_seconds",
			Help:    "Time spent waiting for a backend embedding slot, by lane.",
			Buckets: []float64{0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10},
		}, []string{"lane"}),
		EmbeddingPreflightState: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "athsearch_embedding_preflight_state",
			Help: "One for the current tokenizer preflight state, zero for the others.",
		}, []string{"state"}),
		EmbeddingJobs: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "athsearch_embedding_jobs",
			Help: "Embedding job counts by status.",
		}, []string{"status"}),
		EmbeddingOldestPendingAge: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "athsearch_embedding_oldest_pending_age_seconds",
			Help: "Age of the oldest pending or leased embedding job; zero when the queue is empty.",
		}),
		EmbeddingActiveWorkers: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "athsearch_embedding_active_workers",
			Help: "Workers with a heartbeat inside the freshness window.",
		}),
		SearchableWirelessEvents: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "athsearch_searchable_wireless_events",
			Help: "Wireless events indexed in the last 24 hours.",
		}),
		WirelessNewestObservation: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "athsearch_wireless_newest_observation_seconds",
			Help: "Unix time of the newest indexed wireless observation; zero when nothing is indexed.",
		}),
	}
	registerer.MustRegister(
		m.SearchRequests,
		m.SearchLatency,
		m.ResultsReturned,
		m.EmbeddingCacheHits,
		m.EmbeddingCacheMiss,
		m.SearchFallbacks,
		m.GraphEdgeDensity,
		m.VectorCoverage,
		m.EmbeddingBackendAvailable,
		m.EmbeddingCircuitState,
		m.EmbeddingLimiterInUse,
		m.EmbeddingLimiterCapacity,
		m.EmbeddingLimiterWait,
		m.EmbeddingPreflightState,
		m.EmbeddingJobs,
		m.EmbeddingOldestPendingAge,
		m.EmbeddingActiveWorkers,
		m.SearchableWirelessEvents,
		m.WirelessNewestObservation,
	)
	initializeStableLabelSets(m)
	return m
}

func initializeStableLabelSets(m *Metrics) {
	kinds := []string{"event", "behaviour_window", "frame_sequence", "device", "cross"}
	modes := []string{"dense", "sparse", "hybrid", "unspecified"}
	statuses := []string{"ok", "error"}
	for _, kind := range kinds {
		m.ResultsReturned.WithLabelValues(kind).Add(0)
		for _, mode := range modes {
			m.SearchLatency.WithLabelValues(kind, mode)
			for _, status := range statuses {
				m.SearchRequests.WithLabelValues(kind, mode, status).Add(0)
			}
		}
	}
	for _, kind := range []string{"event", "device", "behaviour", "sequence"} {
		m.VectorCoverage.WithLabelValues(kind).Set(0)
	}
	for _, kind := range []string{"device", "cluster", "ap", "client", "shadow_alert", "alert"} {
		m.GraphEdgeDensity.WithLabelValues(kind).Set(0)
	}
	// Low-cardinality label sets are pre-created so a lane, circuit state or
	// preflight state that has not been observed yet still scrapes as zero
	// instead of disappearing from alert expressions.
	for _, lane := range []string{"interactive", "worker"} {
		m.EmbeddingBackendAvailable.WithLabelValues(lane).Set(0)
		m.EmbeddingLimiterInUse.WithLabelValues(lane).Set(0)
		m.EmbeddingLimiterCapacity.WithLabelValues(lane).Set(0)
		for _, state := range []string{"closed", "open", "half_open"} {
			value := 0
			if state == "closed" {
				value = 1
			}
			m.EmbeddingCircuitState.WithLabelValues(lane, state).Set(float64(value))
		}
	}
	for _, state := range []string{"pending", "compatible", "incompatible", "disabled"} {
		value := 0
		if state == "pending" {
			value = 1
		}
		m.EmbeddingPreflightState.WithLabelValues(state).Set(float64(value))
	}
	for _, status := range []string{"pending", "leased", "completed", "failed"} {
		m.EmbeddingJobs.WithLabelValues(status).Set(0)
	}
}

// ObserveSearchFallback records a search that degraded to keyword-only
// ranking. code is a stable token such as "embedding_backend_unavailable",
// "embedding_invalid_response", or "no_embedding_coverage".
func (m *Metrics) ObserveSearchFallback(kind, code string) {
	m.SearchFallbacks.WithLabelValues(kind, code).Inc()
}

// SetEmbeddingBackendAvailable publishes whether a lane can reach a proven
// healthy backend with its circuit closed.
func (m *Metrics) SetEmbeddingBackendAvailable(lane string, available bool) {
	value := 0.0
	if available {
		value = 1
	}
	m.EmbeddingBackendAvailable.WithLabelValues(lane).Set(value)
}

// SetEmbeddingCircuitState publishes exactly one state per lane so the other
// state series read as zero instead of going stale.
func (m *Metrics) SetEmbeddingCircuitState(lane, state string) {
	for _, candidate := range []string{"closed", "open", "half_open"} {
		value := 0.0
		if candidate == state {
			value = 1
		}
		m.EmbeddingCircuitState.WithLabelValues(lane, candidate).Set(value)
	}
}

// SetEmbeddingLimiter publishes how many backend slots a lane holds and how
// many it may hold.
func (m *Metrics) SetEmbeddingLimiter(lane string, inUse, capacity int) {
	m.EmbeddingLimiterInUse.WithLabelValues(lane).Set(float64(inUse))
	m.EmbeddingLimiterCapacity.WithLabelValues(lane).Set(float64(capacity))
}

// ObserveEmbeddingSlotWait records how long a lane waited for a backend slot.
func (m *Metrics) ObserveEmbeddingSlotWait(lane string, waited time.Duration) {
	m.EmbeddingLimiterWait.WithLabelValues(lane).Observe(waited.Seconds())
}

// SetEmbeddingPreflightState publishes exactly one preflight state.
func (m *Metrics) SetEmbeddingPreflightState(state string) {
	for _, candidate := range []string{"pending", "compatible", "incompatible", "disabled"} {
		value := 0.0
		if candidate == state {
			value = 1
		}
		m.EmbeddingPreflightState.WithLabelValues(candidate).Set(value)
	}
}

// SetEmbeddingJobs publishes the embedding queue counters.
func (m *Metrics) SetEmbeddingJobs(pending, leased, completed, failed int64) {
	m.EmbeddingJobs.WithLabelValues("pending").Set(float64(pending))
	m.EmbeddingJobs.WithLabelValues("leased").Set(float64(leased))
	m.EmbeddingJobs.WithLabelValues("completed").Set(float64(completed))
	m.EmbeddingJobs.WithLabelValues("failed").Set(float64(failed))
}

// ObserveGraphEdgeDensity records edges-per-node observed in a graph response.
func (m *Metrics) ObserveGraphEdgeDensity(nodeKind string, density float64) {
	m.GraphEdgeDensity.WithLabelValues(nodeKind).Set(density)
}

// ObserveVectorCoverage records the number of embedded vectors per kind.
func (m *Metrics) ObserveVectorCoverage(embeddingKind string, vectors float64) {
	m.VectorCoverage.WithLabelValues(embeddingKind).Set(vectors)
}

func (m *Metrics) ObserveSearch(kind, mode, status string, started time.Time, results int) {
	m.SearchRequests.WithLabelValues(kind, mode, status).Inc()
	m.SearchLatency.WithLabelValues(kind, mode).Observe(float64(time.Since(started).Milliseconds()))
	m.ResultsReturned.WithLabelValues(kind).Add(float64(results))
}

func StartServer(ctx context.Context, port int) (*http.Server, error) {
	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return nil, fmt.Errorf("bind metrics server: %w", err)
	}
	server := &http.Server{
		Addr:              listener.Addr().String(),
		Handler:           promhttp.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fmt.Fprintf(os.Stderr, "athsearch metrics server stopped: %v\n", err)
		}
	}()
	return server, nil
}
