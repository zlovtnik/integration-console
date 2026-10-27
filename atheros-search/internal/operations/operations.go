// Package operations presents allowlisted, read-only global measurements.
// It does not own ingestion, embedding recovery, or application readiness.
package operations

import (
	"context"
	"time"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/etlhealth"
)

type Monitor interface {
	Snapshot(context.Context) (etlhealth.ETLHealth, error)
}

type Service struct {
	monitor Monitor
	proxy   *proxyReader
	stats   *statsReader
	now     func() time.Time
}

func New(monitor Monitor, proxyURL, statsURL string) *Service {
	return &Service{monitor: monitor, proxy: newProxyReader(proxyURL), stats: newStatsReader(statsURL), now: time.Now}
}

type Stage struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Owner     string `json:"owner"`
	Status    string `json:"status"`
	Pending   *int64 `json:"pending"`
	Running   *int64 `json:"running"`
	Completed *int64 `json:"completed"`
	Failed    *int64 `json:"failed"`
}

type Worker struct {
	Type       string    `json:"type"`
	LastSeenAt time.Time `json:"last_seen_at"`
}

type Embedding struct {
	Dependency    string                   `json:"dependency"`
	Pending       *int64                   `json:"pending"`
	Leased        *int64                   `json:"leased"`
	Completed     *int64                   `json:"completed"`
	Failed        *int64                   `json:"failed"`
	RetryCount    *int64                   `json:"retry_count"`
	OldestJobAt   *time.Time               `json:"oldest_job_at"`
	QueryBackend  etlhealth.SemanticHealth `json:"query_backend"`
	WorkerBackend etlhealth.SemanticHealth `json:"worker_backend"`
}

type Pipeline struct {
	Scope      string     `json:"scope"`
	MeasuredAt *time.Time `json:"measured_at"`
	Status     string     `json:"status"`
	Stages     []Stage    `json:"stages"`
	Workers    []Worker   `json:"workers"`
	Embedding  Embedding  `json:"embedding"`
	History    History    `json:"history"`
}

func (s *Service) Pipeline(ctx context.Context) Pipeline {
	result := Pipeline{Scope: "global", Status: "unavailable", Stages: []Stage{}, Workers: []Worker{}, Embedding: Embedding{Dependency: "unknown"}}
	// These stable IDs reference the canonical processor catalog, rather than
	// creating another catalog or recovery policy in the browser API.
	result.Stages = []Stage{
		{ID: "sync-scan-ingestion", Label: "Ingestion", Owner: "octopus", Status: "unknown"},
		{ID: "sync-job-planner", Label: "Planning", Owner: "octopus", Status: "unknown"},
		{ID: "sync-load-consumer", Label: "Projection batches", Owner: "octopus", Status: "unknown"},
		{ID: "sync-backlog-recovery", Label: "Coordinator backlog", Owner: "octopus", Status: "unknown"},
		{ID: "embedding-completer", Label: "Embedding execution", Owner: "atheros-search", Status: "unknown"},
		{ID: "embedding-lease-recovery", Label: "Embedding lease recovery", Owner: "atheros-search", Status: "unknown"},
	}
	if h, ok := s.snapshot(ctx); ok {
		result.MeasuredAt = &h.MeasuredAt
		result.Status = measurementStatus(h.MeasuredAt, s.now(), 60*time.Second)
		setStage(&result.Stages[0], h.IngestPending, h.IngestProcessing, nil, h.IngestFailed)
		setStage(&result.Stages[1], h.JobStoredPending, h.JobStoredRunning, &h.JobStoredCompleted, h.JobStoredFailed)
		setStage(&result.Stages[2], h.BatchPending, h.BatchProcessing, &h.BatchCompleted, h.BatchFailed)
		setStage(&result.Stages[3], h.BacklogPending, 0, nil, h.BacklogFailed)
		result.Stages[3].Running = nil // No independent running-backlog gauge exists.
		setStage(&result.Stages[4], h.EmbeddingPending, h.EmbeddingLeased, &h.EmbeddingCompleted, h.EmbeddingFailed)
		result.Stages[4].Status = knownDependency(h.EmbeddingDependency)
		if result.Status == "stale" {
			for i := range result.Stages {
				result.Stages[i].Status = "stale"
			}
		}
		for i, worker := range h.Workers {
			if i >= 128 {
				break
			}
			// Worker IDs and arbitrary metadata can contain hostnames and paths.
			// Only the bounded worker category and heartbeat time are public.
			kind := "other"
			switch worker.WorkerType {
			case "pool", "embedding", "projection":
				kind = worker.WorkerType
			}
			result.Workers = append(result.Workers, Worker{Type: kind, LastSeenAt: worker.LastSeenAt})
		}
		result.Embedding = Embedding{Dependency: knownDependency(h.EmbeddingDependency), Pending: &h.EmbeddingPending, Leased: &h.EmbeddingLeased, Completed: &h.EmbeddingCompleted, Failed: &h.EmbeddingFailed, RetryCount: &h.EmbeddingRetryCount, OldestJobAt: h.OldestEmbeddingJobAt, QueryBackend: safeSemantic(h.QuerySemantic), WorkerBackend: safeSemantic(h.WorkerSemantic)}
	}
	result.History = s.stats.read(ctx)
	return result
}

func safeSemantic(input etlhealth.SemanticHealth) etlhealth.SemanticHealth {
	switch input.PreflightState {
	case "disabled", "pending", "compatible", "incompatible", "unavailable":
	default:
		input.PreflightState = "unknown"
	}
	switch input.CircuitState {
	case "closed", "open", "half_open":
	default:
		input.CircuitState = "unknown"
	}
	return input
}

func (s *Service) snapshot(ctx context.Context) (etlhealth.ETLHealth, bool) {
	if s.monitor == nil {
		return etlhealth.ETLHealth{}, false
	}
	h, err := s.monitor.Snapshot(ctx)
	return h, err == nil && !h.MeasuredAt.IsZero() && !h.MeasuredAt.After(s.now().Add(time.Second))
}

func setStage(stage *Stage, pending, running int64, completed *int64, failed int64) {
	stage.Pending, stage.Running, stage.Completed, stage.Failed = &pending, &running, completed, &failed
	// An empty queue is not proof that its producer is running or ready.
	stage.Status = "idle"
	if pending > 0 || running > 0 {
		stage.Status = "active"
	}
	if failed > 0 {
		stage.Status = "failed"
	}
}

func knownDependency(value string) string {
	switch value {
	case "blocked", "waiting_for_worker", "backlog", "waiting_for_source", "healthy":
		return value
	}
	return "unknown"
}

func measurementStatus(measured, now time.Time, staleAfter time.Duration) string {
	if measured.IsZero() || measured.After(now.Add(time.Second)) {
		return "unavailable"
	}
	if now.Sub(measured) > staleAfter {
		return "stale"
	}
	return "current"
}

type Source struct {
	ID             string     `json:"id"`
	Label          string     `json:"label"`
	Ingestion      string     `json:"ingestion"`
	Projection     string     `json:"projection"`
	Lexical        string     `json:"lexical"`
	Semantic       string     `json:"semantic"`
	Documents      *int64     `json:"documents"`
	Documents24h   *int64     `json:"documents_24h"`
	LastObservedAt *time.Time `json:"last_observed_at"`
	Vectors        *int64     `json:"vectors"`
}

type Sources struct {
	Scope      string     `json:"scope"`
	MeasuredAt *time.Time `json:"measured_at"`
	Status     string     `json:"status"`
	Sources    []Source   `json:"sources"`
}

func (s *Service) Sources(ctx context.Context) Sources {
	result := Sources{Scope: "global", Status: "unavailable", Sources: []Source{
		{ID: "proxy", Label: "Proxy observations", Ingestion: "unknown", Projection: "unknown", Lexical: "unknown", Semantic: "unknown"},
		{ID: "wireless", Label: "Wireless observations", Ingestion: "unknown", Projection: "unknown", Lexical: "unknown", Semantic: "unknown"},
	}}
	h, ok := s.snapshot(ctx)
	if !ok {
		return result
	}
	result.MeasuredAt, result.Status = &h.MeasuredAt, measurementStatus(h.MeasuredAt, s.now(), 60*time.Second)
	for i := range result.Sources {
		source := &result.Sources[i]
		for _, coverage := range h.SourceCoverage {
			if coverage.ID != source.ID {
				continue
			}
			source.Documents, source.Documents24h, source.LastObservedAt, source.Vectors = &coverage.Documents, &coverage.Documents24h, coverage.LastObservedAt, &coverage.Vectors
			source.Lexical, source.Semantic = "empty", "empty"
			if coverage.Documents > 0 {
				source.Lexical = "missing"
				if coverage.LexicalDocuments > 0 {
					source.Lexical = "partial"
				}
				if coverage.LexicalDocuments == coverage.Documents {
					source.Lexical = "available"
				}
				source.Semantic = "missing"
				if coverage.Vectors > 0 {
					source.Semantic = "partial"
				}
				if coverage.Vectors == coverage.Documents {
					source.Semantic = "covered"
				}
			}
			if coverage.LastObservedAt != nil && !coverage.LastObservedAt.After(s.now().Add(time.Second)) {
				source.Projection = "fresh"
				if s.now().Sub(*coverage.LastObservedAt) > 30*time.Minute {
					source.Projection = "stale"
				}
			}
			if result.Status == "stale" {
				source.Projection, source.Lexical, source.Semantic = "stale", "stale", "stale"
			}
		}
	}
	return result
}

func (s *Service) ProxyLive(ctx context.Context) ProxyLive { return s.proxy.read(ctx) }
