package operations

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/etlhealth"
)

type monitorStub struct {
	health etlhealth.ETLHealth
	err    error
}

func (m monitorStub) Snapshot(context.Context) (etlhealth.ETLHealth, error) { return m.health, m.err }

func TestPipelineAllowlistAndDistinctRecoveryResponsibilities(t *testing.T) {
	now := time.Now().UTC()
	h := etlhealth.ETLHealth{MeasuredAt: now, IngestFailed: 3, BacklogPending: 8, EmbeddingPending: 4, EmbeddingFailed: 2, EmbeddingDependency: "blocked", Workers: []etlhealth.WorkerHeartbeat{{WorkerID: "private-host", WorkerType: "private-worker-path", LastSeenAt: now, Metadata: json.RawMessage(`{"password":"private-password"}`)}}, QuerySemantic: etlhealth.SemanticHealth{PreflightState: "private-backend", CircuitState: "private-error"}}
	s := New(monitorStub{health: h}, "", "")
	p := s.Pipeline(t.Context())
	require.Equal(t, "current", p.Status)
	require.Equal(t, int64(3), *p.Stages[0].Failed)
	require.Nil(t, p.Stages[0].Completed, "ingestion does not measure completed count")
	require.Equal(t, "octopus", p.Stages[3].Owner)
	require.Nil(t, p.Stages[3].Running, "unmeasured backlog running must stay unknown")
	require.Equal(t, "embedding-lease-recovery", p.Stages[5].ID)
	require.Equal(t, "atheros-search", p.Stages[5].Owner)
	require.Nil(t, p.Stages[5].Pending)
	require.Equal(t, "unknown", p.Embedding.QueryBackend.PreflightState)
	require.Equal(t, "unknown", p.Embedding.QueryBackend.CircuitState)
	data, err := json.Marshal(p)
	require.NoError(t, err)
	require.NotContains(t, string(data), "private-")
	require.Equal(t, "other", p.Workers[0].Type)
}

func TestPipelineWorkerResponseIsBounded(t *testing.T) {
	h := etlhealth.ETLHealth{MeasuredAt: time.Now(), Workers: make([]etlhealth.WorkerHeartbeat, 1000)}
	require.Len(t, New(monitorStub{health: h}, "", "").Pipeline(t.Context()).Workers, 128)
}

func TestUnavailableMeasurementsNeverBecomeZeroOrReady(t *testing.T) {
	for _, monitor := range []Monitor{nil, monitorStub{}, monitorStub{err: errors.New("private database credential error")}} {
		s := New(monitor, "", "")
		pipeline := s.Pipeline(t.Context())
		require.Equal(t, "unavailable", pipeline.Status)
		require.Nil(t, pipeline.MeasuredAt)
		require.Nil(t, pipeline.Embedding.Completed)
		for _, stage := range pipeline.Stages {
			require.Equal(t, "unknown", stage.Status)
			require.Nil(t, stage.Pending)
		}
		for _, source := range s.Sources(t.Context()).Sources {
			require.Equal(t, "unknown", source.Semantic)
			require.Nil(t, source.Documents)
			require.Nil(t, source.Vectors)
		}
		data, err := json.Marshal(pipeline)
		require.NoError(t, err)
		require.NotContains(t, string(data), "credential")
	}
}

func TestSourcesKeepCoverageSeparateFromGlobalIngestionAndBackend(t *testing.T) {
	now := time.Now().UTC()
	old := now.Add(-time.Hour)
	h := etlhealth.ETLHealth{MeasuredAt: now, EmbeddingCompleted: 99999, QuerySemantic: etlhealth.SemanticHealth{BackendAvailable: true}, SourceCoverage: []etlhealth.SourceCoverage{
		{ID: "proxy", Documents: 12, LexicalDocuments: 12, Documents24h: 2, LastObservedAt: &old, Vectors: 0},
		{ID: "wireless", Documents: 10, Documents24h: 10, LastObservedAt: &now, Vectors: 7},
	}}
	sources := New(monitorStub{health: h}, "", "").Sources(t.Context())
	require.Equal(t, "current", sources.Status)
	proxy, wireless := sources.Sources[0], sources.Sources[1]
	require.Equal(t, "unknown", proxy.Ingestion)
	require.Equal(t, "stale", proxy.Projection)
	require.Equal(t, "available", proxy.Lexical)
	require.Equal(t, "missing", proxy.Semantic, "completed jobs and backend availability do not prove source vectors")
	require.Equal(t, "partial", wireless.Semantic)
	require.Equal(t, int64(0), *proxy.Vectors)
}

func TestSourcesRequireLexicalIndexAndPlausibleObservationTime(t *testing.T) {
	now := time.Now().UTC()
	future := now.Add(time.Hour)
	health := etlhealth.ETLHealth{MeasuredAt: now, SourceCoverage: []etlhealth.SourceCoverage{
		{ID: "proxy", Documents: 2, LexicalDocuments: 0, LastObservedAt: &future},
		{ID: "wireless", Documents: 2, LexicalDocuments: 1},
	}}
	sources := New(monitorStub{health: health}, "", "").Sources(t.Context())
	require.Equal(t, "missing", sources.Sources[0].Lexical)
	require.Equal(t, "unknown", sources.Sources[0].Projection)
	require.Equal(t, "partial", sources.Sources[1].Lexical)
}

func TestStaleAndMissingCoverageCannotClaimReadiness(t *testing.T) {
	now := time.Now().UTC()
	h := etlhealth.ETLHealth{MeasuredAt: now.Add(-61 * time.Second), EmbeddingDependency: "healthy", SourceCoverage: []etlhealth.SourceCoverage{{ID: "proxy", Documents: 10, Vectors: 10, LastObservedAt: &now}}}
	s := New(monitorStub{health: h}, "", "")
	for _, stage := range s.Pipeline(t.Context()).Stages {
		require.Equal(t, "stale", stage.Status)
	}
	sources := s.Sources(t.Context())
	require.Equal(t, "stale", sources.Sources[0].Semantic)
	require.Nil(t, sources.Sources[1].Vectors)
	require.Equal(t, "unknown", sources.Sources[1].Lexical)
	data, err := json.Marshal(sources)
	require.NoError(t, err)
	require.False(t, strings.Contains(string(data), "ready"))
}
