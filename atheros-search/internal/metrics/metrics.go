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
			Help: "Searches that degraded to keyword-only ranking, by kind and reason.",
		}, []string{"kind", "reason"}),
		GraphEdgeDensity: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "athsearch_graph_edge_density",
			Help: "Edges per graph node by node kind, sampled from graph responses.",
		}, []string{"node_kind"}),
		VectorCoverage: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "athsearch_search_vector_coverage",
			Help: "Embedded vectors per embedding kind; zero indicates a kind with no semantic coverage.",
		}, []string{"embedding_kind"}),
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
}

// ObserveSearchFallback records a search that degraded to keyword-only ranking.
// reason is a short stable token such as "backend_unavailable",
// "backend_no_vectors", or "no_kind_coverage".
func (m *Metrics) ObserveSearchFallback(kind, reason string) {
	m.SearchFallbacks.WithLabelValues(kind, reason).Inc()
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
