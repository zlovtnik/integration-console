package httpapi

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/rs/zerolog"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/auth"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/health"
)

func registerHealthRoutes(mux *runtime.ServeMux, tokenAuth *auth.TokenAuth, readiness *health.Readiness, healthMonitor HealthMonitor, wsEnabled bool, allowedOrigins []string, logger zerolog.Logger) error {
	healthz := func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
		logger.Debug().Str("endpoint", "/healthz").Msg("healthz check")
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
	if err := mux.HandlePath("GET", "/healthz", healthz); err != nil {
		return err
	}
	if err := mux.HandlePath("GET", "/v1/healthz", healthz); err != nil {
		return err
	}
	if err := mux.HandlePath("GET", "/readyz", func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
		logger.Debug().Str("endpoint", "/readyz").Msg("readyz check")
		if err := readiness.Check(r.Context()); err != nil {
			logger.Warn().Err(err).Msg("readyz check failed")
			writeError(w, http.StatusServiceUnavailable, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	}); err != nil {
		return err
	}
	if healthMonitor != nil {
		if err := registerJSON(mux, "GET", "/v1/etl/health", tokenAuth, func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
			start := time.Now()
			log := loggerWithTrace(logger.With().Str("endpoint", "/v1/etl/health").Str("method", "GET").Logger(), r.Context())
			log.Info().Msg("etl health request started")

			snapshot, err := healthMonitor.Snapshot(r.Context())
			if err != nil {
				log.Error().Err(err).Dur("latency", time.Since(start)).Msg("etl health failed")
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			log.Info().
				Dur("latency", time.Since(start)).
				Int64("embedding_pending", snapshot.EmbeddingPending).
				Int64("embedding_completed", snapshot.EmbeddingCompleted).
				Int64("batch_pending", snapshot.BatchPending).
				Int("workers", len(snapshot.Workers)).
				Msg("etl health completed")
			writeJSON(w, http.StatusOK, snapshot)
		}); err != nil {
			return err
		}

		if err := registerJSON(mux, "GET", "/v1/etl/embedding/jobs", tokenAuth, func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
			start := time.Now()
			log := loggerWithTrace(logger.With().Str("endpoint", "/v1/etl/embedding/jobs").Str("method", "GET").Logger(), r.Context())
			log.Info().Msg("etl embedding jobs request started")

			snapshot, err := healthMonitor.Snapshot(r.Context())
			if err != nil {
				log.Error().Err(err).Dur("latency", time.Since(start)).Msg("etl embedding jobs failed")
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			result := map[string]int64{
				"pending":   snapshot.EmbeddingPending,
				"leased":    snapshot.EmbeddingLeased,
				"completed": snapshot.EmbeddingCompleted,
				"failed":    snapshot.EmbeddingFailed,
			}
			log.Info().
				Dur("latency", time.Since(start)).
				Int64("pending", snapshot.EmbeddingPending).
				Int64("failed", snapshot.EmbeddingFailed).
				Msg("etl embedding jobs completed")
			writeJSON(w, http.StatusOK, result)
		}); err != nil {
			return err
		}

		if err := registerJSON(mux, "GET", "/v1/etl/workers", tokenAuth, func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
			start := time.Now()
			log := loggerWithTrace(logger.With().Str("endpoint", "/v1/etl/workers").Str("method", "GET").Logger(), r.Context())
			log.Info().Msg("etl workers request started")

			snapshot, err := healthMonitor.Snapshot(r.Context())
			if err != nil {
				log.Error().Err(err).Dur("latency", time.Since(start)).Msg("etl workers failed")
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			log.Info().
				Dur("latency", time.Since(start)).
				Int("worker_count", len(snapshot.Workers)).
				Msg("etl workers completed")
			writeJSON(w, http.StatusOK, map[string]any{"workers": snapshot.Workers})
		}); err != nil {
			return err
		}

		if wsEnabled {
			upgrader := websocket.Upgrader{
				ReadBufferSize:  1024,
				WriteBufferSize: 1024,
				CheckOrigin: func(r *http.Request) bool {
					if len(allowedOrigins) == 0 {
						return true
					}
					origin := r.Header.Get("Origin")
					for _, o := range allowedOrigins {
						if o == origin {
							return true
						}
					}
					return false
				},
			}

			if err := mux.HandlePath("GET", "/v1/etl/stream", func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
				decision := tokenAuth.AuthorizeAuthorization(r.Context(), r.Header.Get("Authorization"), auth.RoleViewer, auth.RoleOperator, auth.RoleAdmin)
				if decision != auth.DecisionAuthorized {
					writeAuthorizationError(w, decision)
					return
				}
				start := time.Now()
				log := loggerWithTrace(logger.With().Str("endpoint", "/v1/etl/stream").Str("method", "GET").Logger(), r.Context())
				log.Info().Msg("etl stream request started")

				conn, err := upgrader.Upgrade(w, r, nil)
				if err != nil {
					log.Error().Err(err).Msg("websocket upgrade failed")
					return
				}
				defer func() { _ = conn.Close() }() // Closing an already disconnected socket is best-effort cleanup.

				log.Info().Dur("latency", time.Since(start)).Msg("etl stream connected")

				if err := conn.SetReadDeadline(time.Now().Add(60 * time.Second)); err != nil {
					log.Info().Err(err).Msg("etl stream read deadline failed")
					return
				}
				conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(60 * time.Second)) })
				disconnected := make(chan struct{})
				go func() {
					defer close(disconnected)
					for {
						if _, _, err := conn.ReadMessage(); err != nil {
							return
						}
					}
				}()

				ticker := time.NewTicker(5 * time.Second)
				defer ticker.Stop()

				pingTicker := time.NewTicker(30 * time.Second)
				defer pingTicker.Stop()

				for {
					select {
					case <-disconnected:
						return
					case <-r.Context().Done():
						log.Info().Msg("etl stream client disconnected")
						if err := conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), time.Now().Add(time.Second)); err != nil {
							log.Debug().Err(err).Msg("etl stream close message failed")
						}
						return
					case <-ticker.C:
						snapshot, err := healthMonitor.Snapshot(r.Context())
						if err != nil {
							log.Error().Err(err).Msg("etl stream snapshot failed")
							continue
						}
						data, err := json.Marshal(snapshot)
						if err != nil {
							log.Error().Err(err).Msg("etl stream encode failed")
							continue
						}
						if err := conn.SetWriteDeadline(time.Now().Add(10 * time.Second)); err != nil {
							log.Info().Err(err).Msg("etl stream write deadline failed")
							return
						}
						if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
							log.Info().Err(err).Msg("etl stream write failed")
							return
						}
					case <-pingTicker.C:
						if err := conn.SetWriteDeadline(time.Now().Add(10 * time.Second)); err != nil {
							log.Info().Err(err).Msg("etl stream ping deadline failed")
							return
						}
						if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
							log.Info().Err(err).Msg("etl stream ping failed")
							return
						}
					}
				}
			}); err != nil {
				return err
			}
		}
	}
	return nil
}
