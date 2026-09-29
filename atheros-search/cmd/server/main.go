package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/api"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/auth"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/config"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/db"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/embed"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/health"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/metrics"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/observability"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/search"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/worker"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		if err := runHealthcheck(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("load config")
	}
	level, err := zerolog.ParseLevel(cfg.LogLevel)
	if err != nil {
		level = zerolog.InfoLevel
	}
	zerolog.TimestampFieldName = "timestamp"
	zerolog.MessageFieldName = "event"
	zerolog.SetGlobalLevel(level)
	logger := log.With().Str("service", "atheros-search").Logger()
	logStartupConfig(logger, cfg)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	tracerProvider, err := observability.InitTracing(ctx, "atheros-search")
	if err != nil {
		logger.Fatal().Err(err).Msg("configure OTLP tracing")
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := tracerProvider.Shutdown(shutdownCtx); err != nil {
			logger.Warn().Err(err).Msg("trace provider shutdown failed")
		}
	}()

	pool, err := db.NewPool(ctx, db.Options{
		DSN:                  cfg.PostgresDSN,
		TLSCAFile:            cfg.PostgresTLSCAFile,
		TLSCertFile:          cfg.PostgresTLSCertFile,
		TLSKeyFile:           cfg.PostgresTLSKeyFile,
		TLSServerName:        cfg.PostgresTLSServerName,
		SchemaManifestSHA256: cfg.PostgresSchemaManifestSHA256,
		MaxOpenConns:         cfg.PostgresMaxOpenConns,
		MaxIdleConns:         cfg.PostgresMaxIdleConns,
		ConnMaxLifetime:      cfg.PostgresConnMaxLifetime,
		ConnMaxIdleTime:      cfg.PostgresConnMaxIdleTime,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("connect Postgres")
	}
	defer pool.Close()
	if cfg.SchemaReadyRequired {
		if err := health.WaitForSchemaReady(ctx, pool, cfg.SchemaReadyTimeout, cfg.SchemaReadyPollInterval, logger); err != nil {
			logger.Fatal().Err(err).Msg("schema readiness gate failed")
		}
	} else {
		logger.Warn().Msg("schema readiness gate disabled")
	}

	var tokenAuth *auth.TokenAuth
	if cfg.JWTIssuer != "" {
		tokenAuth, err = auth.NewJWTTokenAuth(auth.JWTConfig{
			Issuer:   cfg.JWTIssuer,
			JWKSURI:  cfg.JWTJWKSURI,
			Audience: cfg.JWTAudience,
			ClientID: cfg.JWTClientID,
		})
	} else {
		tokenAuth, err = auth.NewTokenAuth(cfg.APIKeySHA256)
	}
	if err != nil {
		logger.Fatal().Err(err).Msg("configure auth")
	}

	m := metrics.New()

	var embedder embed.Client
	var lanes *embed.LanedClient
	var scheduler *embed.Scheduler
	var preflight *embed.Preflight
	if cfg.EmbeddingBackend == "" {
		embedder = embed.NoopClient{Dimensions: cfg.EmbeddingDimensions}
		preflight = embed.NewPreflight(nil)
		logger.Warn().Msg("embedding backend not configured; using zero-vector embedder")
	} else {
		httpEmbedder := embed.NewHTTPClient(cfg.EmbeddingBackend, cfg.EmbeddingModel, cfg.EmbeddingDimensions, cfg.EmbeddingMaxTokens)
		scheduler = embed.NewScheduler(cfg.EmbeddingRequestConcurrency, cfg.EmbeddingQueryReservedSlots)
		httpEmbedder.Scheduler = scheduler
		httpEmbedder.TokenizerConcurrency = cfg.EmbeddingTokenizerConcurrency
		httpEmbedder.MaxChunksPerInput = cfg.EmbeddingMaxChunksPerInput
		lanes = embed.NewLanedClient(httpEmbedder)
		embedder = lanes
		// Tokenizer compatibility is proven in the background instead of at
		// startup: a bad backend must not keep the whole API from serving the
		// keyword paths it does not need.
		preflight = embed.NewPreflight(httpEmbedder.ValidateTokenizer)
		preflight.SetTransitionObserver(func(state embed.PreflightState) {
			m.SetEmbeddingPreflightState(string(state))
			log := logger.Info()
			if state != embed.PreflightCompatible {
				log = logger.Warn()
			}
			log.Str("preflight_state", string(state)).Msg("embedding tokenizer preflight state changed")
		})
		m.SetEmbeddingPreflightState(string(preflight.Snapshot().State))
		go preflight.Run(ctx)
	}
	if scheduler != nil {
		scheduler.SetWaitObserver(func(lane embed.Lane, waited time.Duration, _ bool) {
			m.ObserveEmbeddingSlotWait(string(lane), waited)
		})
	}
	embedder = embed.CachedClient{
		Inner: embedder,
		Cache: embed.NewQueryCache(4096, 60*time.Second),
		Hits:  m.EmbeddingCacheHits.Inc,
		Miss:  m.EmbeddingCacheMiss.Inc,
	}

	healthMon := worker.NewHealthMonitor(pool.DB)
	healthMon.SetSemanticStatus(&semanticStatus{preflight: preflight, lanes: lanes})
	healthMon.SetSnapshotObserver(func(snapshot worker.ETLHealth) {
		m.SetEmbeddingJobs(snapshot.EmbeddingPending, snapshot.EmbeddingLeased, snapshot.EmbeddingCompleted, snapshot.EmbeddingFailed)
		m.EmbeddingOldestPendingAge.Set(oldestJobAge(snapshot.OldestEmbeddingJobAt))
		m.EmbeddingActiveWorkers.Set(float64(len(snapshot.Workers)))
		m.SearchableWirelessEvents.Set(float64(snapshot.WirelessEvents24h))
		m.WirelessNewestObservation.Set(newestObservationUnix(snapshot.WirelessLastObservedAt))
	})
	// Prime the snapshot cache so the first /v1/etl/* caller is not the one
	// that pays for a full refresh of the multi-million row queue gauges.
	go healthMon.Warm(ctx)
	go publishEmbeddingGauges(ctx, m, scheduler, lanes, preflight)

	var workerPool *worker.Pool
	if cfg.WorkerEnabled {
		workerPool = worker.NewPool(pool.DB, &workerEmbedderAdapter{embedder: embedder}, worker.PoolConfig{
			WorkerCount:       cfg.WorkerCount,
			LeaseSeconds:      cfg.LeaseSeconds,
			PollInterval:      cfg.WorkerPollInterval,
			BatchSize:         cfg.EmbeddingBatchSize,
			WorkerID:          cfg.WorkerID,
			HealthPollEnabled: true,
			ClaimGate:         preflight,
		}, logger)
		workerPool.Start(ctx)
	} else {
		logger.Info().Msg("worker pool disabled (ATHSEARCH_WORKER_ENABLED=false)")
	}

	svc := search.NewService(pool.DB, embedder, cfg, m, logger)
	readiness := &health.Readiness{DB: pool, Metrics: m, SchemaReadyRequired: cfg.SchemaReadyRequired}

	metricsServer, err := metrics.StartServer(ctx, cfg.MetricsPort)
	if err != nil {
		logger.Fatal().Err(err).Msg("start metrics server")
	}
	grpcServer, err := api.StartGRPC(ctx, cfg.GRPCPort, svc, tokenAuth, logger)
	if err != nil {
		logger.Fatal().Err(err).Msg("start grpc server")
	}
	httpServer, err := api.StartHTTP(ctx, cfg.HTTPPort, cfg.CORSAllowedOrigins, svc, readiness, tokenAuth, healthMon, cfg.WSEnabled, logger)
	if err != nil {
		logger.Fatal().Err(err).Msg("start http gateway")
	}

	<-ctx.Done()
	logger.Info().Msg("shutdown requested")
	if workerPool != nil {
		workerPool.Stop()
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Warn().Err(err).Msg("http gateway shutdown failed")
	}
	if err := metricsServer.Shutdown(shutdownCtx); err != nil {
		logger.Warn().Err(err).Msg("metrics server shutdown failed")
	}
	grpcStopped := make(chan struct{})
	go func() {
		grpcServer.GracefulStop()
		close(grpcStopped)
	}()
	select {
	case <-grpcStopped:
	case <-shutdownCtx.Done():
		grpcServer.Stop()
		logger.Warn().Err(shutdownCtx.Err()).Msg("grpc graceful shutdown timed out")
	}
}

func logStartupConfig(logger zerolog.Logger, cfg config.Config) {
	logger.Info().
		Bool("embedding_backend_configured", cfg.EmbeddingBackend != "").
		Str("embedding_model", cfg.EmbeddingModel).
		Int("dense_overfetch_factor", cfg.DenseOverfetchFactor).
		Bool("worker_enabled", cfg.WorkerEnabled).
		Int("worker_count", cfg.WorkerCount).
		Int("embedding_request_concurrency", cfg.EmbeddingRequestConcurrency).
		Int("embedding_query_reserved_slots", cfg.EmbeddingQueryReservedSlots).
		Int("embedding_tokenizer_concurrency", cfg.EmbeddingTokenizerConcurrency).
		Int("embedding_max_chunks_per_input", cfg.EmbeddingMaxChunksPerInput).
		Msg("atheros-search Postgres query facade configured")
}

type workerEmbedderAdapter struct {
	embedder embed.Client
}

// Embed tags the call as bulk work so the shared scheduler reserves
// interactive slots and the worker breaker, not the query breaker, records the
// outcome.
func (a *workerEmbedderAdapter) Embed(ctx context.Context, texts []string, kind string) ([][]float32, error) {
	return a.embedder.Embed(embed.WithLane(ctx, embed.LaneWorker), texts, embed.Kind(kind))
}

// semanticStatus publishes the live preflight and per-lane circuit view that
// /v1/etl/health merges over its cached database snapshot.
type semanticStatus struct {
	preflight *embed.Preflight
	lanes     *embed.LanedClient
}

func (s *semanticStatus) QuerySemantic() worker.SemanticHealth {
	return s.forLane(embed.LaneInteractive)
}

func (s *semanticStatus) WorkerSemantic() worker.SemanticHealth {
	return s.forLane(embed.LaneWorker)
}

func (s *semanticStatus) forLane(lane embed.Lane) worker.SemanticHealth {
	if s == nil {
		return worker.SemanticHealth{}
	}
	status := worker.SemanticHealth{PreflightState: string(embed.PreflightDisabled), CircuitState: string(embed.CircuitClosed)}
	ready := false
	if s.preflight != nil {
		preflight := s.preflight.Snapshot()
		status.PreflightState = string(preflight.State)
		ready = preflight.State == embed.PreflightCompatible
		status.LastCheckAt = timeOrNil(preflight.LastCheckAt)
		status.LastSuccessAt = timeOrNil(preflight.LastSuccessAt)
	}
	if laneClient := s.lanes.Lane(lane); laneClient != nil {
		circuit := laneClient.Snapshot()
		status.CircuitState = string(circuit.State)
		if check := timeOrNil(circuit.LastCheckAt); check != nil {
			status.LastCheckAt = check
		}
		if success := timeOrNil(circuit.LastSuccessAt); success != nil {
			status.LastSuccessAt = success
		}
		status.RetryAt = timeOrNil(circuit.RetryAt)
	}
	status.BackendAvailable = ready && status.CircuitState != string(embed.CircuitOpen)
	return status
}

// publishEmbeddingGauges refreshes the breaker, limiter and preflight series
// on a fixed cadence so an idle deployment still scrapes fresh state.
func publishEmbeddingGauges(ctx context.Context, m *metrics.Metrics, scheduler *embed.Scheduler, lanes *embed.LanedClient, preflight *embed.Preflight) {
	publish := func() {
		if preflight != nil {
			m.SetEmbeddingPreflightState(string(preflight.Snapshot().State))
		}
		if scheduler == nil || lanes == nil {
			return
		}
		ready := preflight != nil && preflight.Ready()
		for _, lane := range embed.Lanes {
			laneClient := lanes.Lane(lane)
			state := embed.CircuitClosed
			if laneClient != nil {
				state = laneClient.State()
			}
			m.SetEmbeddingCircuitState(string(lane), string(state))
			capacity := scheduler.Total()
			if lane == embed.LaneWorker {
				capacity = scheduler.WorkerMax()
			}
			m.SetEmbeddingLimiter(string(lane), scheduler.InUse(lane), capacity)
			m.SetEmbeddingBackendAvailable(string(lane), ready && state != embed.CircuitOpen)
		}
	}
	publish()
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			publish()
		}
	}
}

func oldestJobAge(oldest *time.Time) float64 {
	if oldest == nil {
		return 0
	}
	age := time.Since(*oldest).Seconds()
	if age < 0 {
		return 0
	}
	return age
}

func newestObservationUnix(newest *time.Time) float64 {
	if newest == nil {
		return 0
	}
	return float64(newest.Unix())
}

func timeOrNil(value time.Time) *time.Time {
	if value.IsZero() {
		return nil
	}
	utc := value.UTC()
	return &utc
}

func runHealthcheck() error {
	port := 8080
	if raw := os.Getenv("ATHSEARCH_HTTP_PORT"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			return fmt.Errorf("invalid ATHSEARCH_HTTP_PORT: %w", err)
		}
		port = parsed
	}
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/readyz", port))
	if err != nil {
		return fmt.Errorf("readyz request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("readyz returned %s", resp.Status)
	}
	return nil
}
