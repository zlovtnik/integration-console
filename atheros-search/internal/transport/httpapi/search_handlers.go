package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/rs/zerolog"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/auth"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/search"
	searchv1 "github.com/zlovtnik/ssl-proxy/services/atheros-search/proto/atheros/search/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func registerSearchRoutes(mux *runtime.ServeMux, tokenAuth *auth.TokenAuth, svc SearchService, logger zerolog.Logger) error {
	if err := registerJSON(mux, "POST", "/v1/search", tokenAuth, func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
		start := time.Now()
		reqID := requestID()
		log := loggerWithTrace(logger.With().Str("endpoint", "/v1/search").Str("method", "POST").Str("req_id", reqID).Logger(), r.Context())
		log.Info().Msg("search request started")

		body, ok := readRequestBody(w, r)
		if !ok {
			log.Error().Dur("latency", time.Since(start)).Msg("search request failed: read body")
			return
		}
		var req searchv1.SearchRequest
		if err := protojson.Unmarshal(body, &req); err != nil {
			log.Error().Err(err).Dur("latency", time.Since(start)).Msg("search request failed: unmarshal")
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		log = log.With().
			Bool("has_query", strings.TrimSpace(req.Query) != "").
			Str("query_hash", shortHash(req.Query)).
			Str("kind", req.Kind.String()).
			Str("mode", req.Mode.String()).
			Int32("top_k", req.TopK).
			Bool("has_session_id", strings.TrimSpace(req.SessionId) != "").
			Str("session_id_hash", shortHash(req.SessionId)).
			Bool("has_filters", req.Filters != nil).
			Logger()
		log.Info().Msg("search dispatched")

		resp, err := svc.Search(r.Context(), &req)
		if err != nil {
			log.Error().Err(err).Dur("latency", time.Since(start)).Msg("search failed")
			writeSearchError(w, err)
			return
		}
		log.Info().
			Dur("latency", time.Since(start)).
			Int("result_count", len(resp.Results)).
			Str("mode_used", resp.ModeUsed.String()).
			Str("fallback_reason", resp.FallbackReason).
			Int32("dense_count", resp.DenseResultCount).
			Int32("sparse_count", resp.SparseResultCount).
			Int32("fused_count", resp.FusedResultCount).
			Int64("query_id", resp.QueryId).
			Msg("search completed")
		writeProtoJSON(w, http.StatusOK, resp, log)
	}); err != nil {
		return err
	}
	if err := registerJSON(mux, "POST", "/v1/search/stream", tokenAuth, func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
		start := time.Now()
		reqID := requestID()
		log := loggerWithTrace(logger.With().Str("endpoint", "/v1/search/stream").Str("method", "POST").Str("req_id", reqID).Logger(), r.Context())
		log.Info().Msg("search stream request started")

		body, ok := readRequestBody(w, r)
		if !ok {
			log.Error().Dur("latency", time.Since(start)).Msg("search stream failed: read body")
			return
		}
		var req searchv1.SearchRequest
		if err := protojson.Unmarshal(body, &req); err != nil {
			log.Error().Err(err).Dur("latency", time.Since(start)).Msg("search stream failed: unmarshal")
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		log = log.With().
			Bool("has_query", strings.TrimSpace(req.Query) != "").
			Str("query_hash", shortHash(req.Query)).
			Str("kind", req.Kind.String()).
			Str("mode", req.Mode.String()).
			Int32("top_k", req.TopK).
			Bool("has_session_id", strings.TrimSpace(req.SessionId) != "").
			Str("session_id_hash", shortHash(req.SessionId)).
			Bool("has_filters", req.Filters != nil).
			Logger()
		log.Info().Msg("search stream dispatched")

		resp, err := svc.Search(r.Context(), &req)
		if err != nil {
			log.Error().Err(err).Dur("latency", time.Since(start)).Msg("search stream failed")
			writeSearchError(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/x-ndjson")
		streamed := 0
		for _, result := range resp.Results {
			encoded, err := protojson.Marshal(result)
			if err != nil {
				log.Warn().Err(err).Int("streamed", streamed).Dur("latency", time.Since(start)).Msg("search stream marshal error")
				return
			}
			if _, err := io.Copy(w, bytes.NewReader(encoded)); err != nil {
				log.Warn().Err(err).Int("streamed", streamed).Dur("latency", time.Since(start)).Msg("search stream write error")
				return
			}
			if _, err := io.WriteString(w, "\n"); err != nil {
				log.Warn().Err(err).Int("streamed", streamed).Dur("latency", time.Since(start)).Msg("search stream write newline error")
				return
			}
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
			streamed++
		}
		metadata := proto.Clone(resp).(*searchv1.SearchResponse)
		metadata.Results = nil
		encodedMeta, err := protojson.Marshal(metadata)
		if err != nil {
			return
		}
		done, err := json.Marshal(map[string]any{"type": "done", "meta": json.RawMessage(encodedMeta)})
		if err != nil {
			return
		}
		if _, err := io.WriteString(w, string(done)+"\n"); err != nil {
			log.Warn().Err(err).Int("streamed", streamed).Dur("latency", time.Since(start)).Msg("search stream done marker write error")
			return
		}
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		log.Info().
			Dur("latency", time.Since(start)).
			Int("result_count", streamed).
			Int64("query_id", resp.QueryId).
			Msg("search stream completed")
	}); err != nil {
		return err
	}
	if err := registerJSON(mux, "GET", "/v1/explain/{source_key}", tokenAuth, func(w http.ResponseWriter, r *http.Request, params map[string]string) {
		start := time.Now()
		reqID := requestID()
		log := loggerWithTrace(logger.With().Str("endpoint", "/v1/explain").Str("method", "GET").Str("req_id", reqID).Logger(), r.Context())

		sourceKey := params["source_key"]
		query := r.URL.Query().Get("query")
		kind := parseKind(r.URL.Query().Get("kind"))
		log = log.With().
			Bool("has_source_key", strings.TrimSpace(sourceKey) != "").
			Str("source_key_hash", shortHash(sourceKey)).
			Bool("has_query", strings.TrimSpace(query) != "").
			Str("query_hash", shortHash(query)).
			Str("kind", kind.String()).
			Logger()
		log.Info().Msg("explain request started")

		req := &searchv1.ExplainRequest{
			SourceKey: sourceKey,
			Query:     query,
			Kind:      kind,
		}
		resp, err := svc.ExplainDetails(r.Context(), req)
		if err != nil {
			log.Error().Err(err).Dur("latency", time.Since(start)).Msg("explain failed")
			writeError(w, httpStatusFromError(err), err.Error())
			return
		}
		log.Info().
			Dur("latency", time.Since(start)).
			Float64("fused_score", float64(resp.FusedScore)).
			Int("boost_reasons", len(resp.BoostReasons)).
			Bool("found", resp.Found).
			Bool("scores_available", resp.ScoresAvailable).
			Msg("explain completed")
		writeJSON(w, http.StatusOK, resp)
	}); err != nil {
		return err
	}
	if err := registerJSON(mux, "GET", "/v1/records/{source_key}/context", tokenAuth, func(w http.ResponseWriter, r *http.Request, params map[string]string) {
		start := time.Now()
		reqID := requestID()
		log := loggerWithTrace(logger.With().Str("endpoint", "/v1/records/context").Str("method", "GET").Str("req_id", reqID).Logger(), r.Context())

		sourceKey := params["source_key"]
		query := r.URL.Query()
		window, err := parseDurationParam(query.Get("window"), search.RecordContextDefaultWindow, search.RecordContextMaxWindow)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		bucket, err := parseIntParam(query.Get("bucket_minutes"), search.RecordContextDefaultBuckets, 1, 24*60)
		if err != nil {
			// A malformed query parameter is a client error. httpStatusFromError
			// has no substring match for these messages and would report 500.
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		kind := parseKind(query.Get("kind"))
		log = log.With().
			Bool("has_source_key", strings.TrimSpace(sourceKey) != "").
			Str("source_key_hash", shortHash(sourceKey)).
			Dur("window", window).
			Int("bucket_minutes", bucket).
			Str("kind", kind.String()).
			Logger()
		log.Info().Msg("record context request started")

		resp, err := svc.RecordContext(r.Context(), search.RecordContextRequest{
			SourceKey:     sourceKey,
			Kind:          kind,
			Window:        window,
			BucketMinutes: bucket,
		})
		if err != nil {
			log.Error().Err(err).Dur("latency", time.Since(start)).Msg("record context failed")
			writeError(w, httpStatusFromError(err), err.Error())
			return
		}
		log.Info().
			Dur("latency", time.Since(start)).
			Bool("found", resp.Found).
			Int("activity_buckets", len(resp.Activity)).
			Int("embedding_jobs", len(resp.Embedding)).
			Bool("has_related", resp.Related != nil).
			Msg("record context completed")
		writeJSON(w, http.StatusOK, resp)
	}); err != nil {
		return err
	}
	if err := registerJSON(mux, "GET", "/v1/suggest/filters", tokenAuth, func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
		start := time.Now()
		reqID := requestID()
		prefix := r.URL.Query().Get("prefix")
		log := loggerWithTrace(logger.With().
			Str("endpoint", "/v1/suggest/filters").
			Str("method", "GET").
			Str("req_id", reqID).
			Bool("has_prefix", strings.TrimSpace(prefix) != "").
			Str("prefix_hash", shortHash(prefix)).
			Logger(), r.Context())
		log.Info().Msg("suggest filters request started")

		resp, err := svc.SuggestFilters(r.Context(), &searchv1.SuggestFiltersRequest{Prefix: prefix})
		if err != nil {
			log.Error().Err(err).Dur("latency", time.Since(start)).Msg("suggest filters failed")
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		log.Info().
			Dur("latency", time.Since(start)).
			Int("ssids", len(resp.Ssids)).
			Int("location_ids", len(resp.LocationIds)).
			Int("sensor_ids", len(resp.SensorIds)).
			Int("frame_subtypes", len(resp.FrameSubtypes)).
			Msg("suggest filters completed")
		writeProtoJSON(w, http.StatusOK, resp, log)
	}); err != nil {
		return err
	}
	if err := registerJSON(mux, "POST", "/v1/explain/scoped", tokenAuth, func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
		body, ok := readRequestBody(w, r)
		if !ok {
			return
		}
		var payload struct {
			SourceKey string          `json:"source_key"`
			Query     string          `json:"query"`
			Kind      string          `json:"kind"`
			Filters   json.RawMessage `json:"filters"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		var filters *searchv1.SearchFilters
		if len(payload.Filters) > 0 && string(payload.Filters) != "null" {
			filters = &searchv1.SearchFilters{}
			if err := protojson.Unmarshal(payload.Filters, filters); err != nil {
				writeError(w, http.StatusBadRequest, "invalid scoped explain filters")
				return
			}
		}
		resp, err := svc.ExplainScoped(r.Context(), search.ScopedExplainRequest{SourceKey: payload.SourceKey, Query: payload.Query, Kind: parseKind(payload.Kind), Filters: filters})
		if err != nil {
			writeError(w, httpStatusFromError(err), err.Error())
			return
		}
		writeJSON(w, http.StatusOK, resp)
	}); err != nil {
		return err
	}
	return nil
}
