package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/apperror"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/auth"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/embed"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/etlhealth"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/health"
	searchv1 "github.com/zlovtnik/ssl-proxy/services/atheros-search/proto/atheros/search/v1"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func httpStatusFromError(err error) int {
	if err == nil {
		return http.StatusOK
	}

	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return http.StatusGatewayTimeout
	}
	var bodyLimit *http.MaxBytesError
	if errors.As(err, &bodyLimit) {
		return http.StatusRequestEntityTooLarge
	}
	switch {
	case errors.Is(err, apperror.ErrValidation), errors.Is(err, embed.ErrInvalidRequest), errors.Is(err, embed.ErrOversizedInput):
		return http.StatusBadRequest
	case errors.Is(err, apperror.ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, apperror.ErrConflict):
		return http.StatusConflict
	case errors.Is(err, apperror.ErrForbidden):
		return http.StatusForbidden
	case errors.Is(err, apperror.ErrUnavailable):
		return http.StatusServiceUnavailable
	}

	return http.StatusInternalServerError
}

const maxRequestBodyBytes int64 = 1 << 20

func corsMiddleware(next http.Handler, allowedOrigins []string) http.Handler {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		if origin = strings.TrimSpace(origin); origin != "" {
			allowed[origin] = struct{}{}
		}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" {
			w.Header().Add("Vary", "Origin")
			if _, ok := allowed[origin]; ok {
				w.Header().Set("Access-Control-Allow-Origin", origin)
			}
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Max-Age", "86400")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

type HealthMonitor interface {
	Snapshot(ctx context.Context) (etlhealth.ETLHealth, error)
}

func StartHTTP(ctx context.Context, port int, allowedOrigins []string, svc Services, readiness *health.Readiness, tokenAuth *auth.TokenAuth, healthMonitor HealthMonitor, wsEnabled bool, logger zerolog.Logger) (*http.Server, error) {
	mux := runtime.NewServeMux()
	if err := registerSearchRoutes(mux, tokenAuth, svc.Search, logger); err != nil {
		return nil, err
	}
	if err := registerAssetsRoutes(mux, tokenAuth, svc.Assets, logger); err != nil {
		return nil, err
	}
	if err := registerReportingRoutes(mux, tokenAuth, svc.Reporting, logger); err != nil {
		return nil, err
	}
	if err := registerSavedViews(mux, tokenAuth, svc.SavedViews, logger); err != nil {
		return nil, err
	}
	if err := registerHealthRoutes(mux, tokenAuth, readiness, healthMonitor, wsEnabled, allowedOrigins, logger); err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return nil, fmt.Errorf("bind http server: %w", err)
	}
	server := &http.Server{
		Addr:              listener.Addr().String(),
		Handler:           otelhttp.NewHandler(corsMiddleware(mux, allowedOrigins), "atheros-search.http"),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			logger.Warn().Err(err).Msg("http gateway shutdown failed")
		}
	}()
	go func() {
		logger.Info().Int("port", port).Msg("http gateway listening")
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			logger.Error().Err(err).Msg("http gateway stopped")
		}
	}()
	return server, nil
}

func readRequestBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRequestBodyBytes))
	if err == nil {
		return body, true
	}
	var maxBytesError *http.MaxBytesError
	if errors.As(err, &maxBytesError) {
		writeError(w, http.StatusRequestEntityTooLarge, "request body too large")
		return nil, false
	}
	writeError(w, http.StatusBadRequest, err.Error())
	return nil, false
}

func registerJSON(mux *runtime.ServeMux, method, pattern string, tokenAuth *auth.TokenAuth, handler func(http.ResponseWriter, *http.Request, map[string]string)) error {
	return registerJSONRoles(mux, method, pattern, tokenAuth, []string{auth.RoleViewer, auth.RoleOperator, auth.RoleAdmin}, handler)
}

func registerJSONRoles(mux *runtime.ServeMux, method, pattern string, tokenAuth *auth.TokenAuth, allowedRoles []string, handler func(http.ResponseWriter, *http.Request, map[string]string)) error {
	return mux.HandlePath(method, pattern, func(w http.ResponseWriter, r *http.Request, params map[string]string) {
		decision, identity := tokenAuth.AuthorizeIdentity(r.Context(), r.Header.Get("Authorization"), allowedRoles...)
		if decision != auth.DecisionAuthorized {
			writeAuthorizationError(w, decision)
			return
		}
		ctx := auth.WithSubject(r.Context(), identity.Display)
		handler(w, r.WithContext(auth.WithIdentity(ctx, identity)), params)
	})
}

func writeAuthorizationError(w http.ResponseWriter, decision auth.Decision) {
	if decision == auth.DecisionForbidden {
		writeError(w, http.StatusForbidden, "insufficient role")
		return
	}
	w.Header().Set("WWW-Authenticate", `Bearer realm="atheros-search"`)
	writeError(w, http.StatusUnauthorized, "missing or invalid bearer token")
}

func writeProtoJSON(w http.ResponseWriter, status int, msg proto.Message, logger zerolog.Logger) {
	encoded, err := protojson.Marshal(msg)
	if err != nil {
		logger.Error().Err(err).Msg("marshal protobuf response")
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if _, err := w.Write(encoded); err != nil {
		logger.Debug().Err(err).Msg("write protobuf response failed")
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	encoded, err := json.Marshal(value)
	if err != nil {
		log.Error().Err(err).Msg("marshal JSON response failed")
		status = http.StatusInternalServerError
		encoded = []byte(`{"error":"internal server error"}`)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if _, err := w.Write(append(encoded, '\n')); err != nil {
		log.Debug().Err(err).Msg("write JSON response failed")
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	if status >= http.StatusInternalServerError {
		message = "internal server error"
	}
	writeJSON(w, status, map[string]string{"error": message})
}

// writeSearchError renders a search failure. A semantic outage is a
// deliberate, safe answer: 503 with the stable fallback code and a
// Retry-After hint instead of the generic masked server error.
func writeSearchError(w http.ResponseWriter, err error) {
	var unavailable *apperror.UnavailableError
	if errors.As(err, &unavailable) {
		if !unavailable.RetryAt.IsZero() {
			if seconds := int(time.Until(unavailable.RetryAt).Seconds()); seconds > 0 {
				w.Header().Set("Retry-After", strconv.Itoa(seconds))
			}
		}
		body := map[string]string{"error": unavailable.Message, "code": unavailable.Code}
		writeJSON(w, http.StatusServiceUnavailable, body)
		return
	}
	writeError(w, httpStatusFromError(err), err.Error())
}

// parseDurationParam accepts a Go duration string and clamps it to a ceiling.
// An absent value selects the default, so callers never have to branch.
func parseDurationParam(value string, fallback, ceiling time.Duration) (time.Duration, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback, nil
	}
	parsed, err := time.ParseDuration(trimmed)
	if err != nil {
		return 0, errors.New("window must be a duration such as 24h")
	}
	if parsed <= 0 {
		return 0, errors.New("window must be positive")
	}
	if parsed > ceiling {
		return ceiling, nil
	}
	return parsed, nil
}

func parseIntParam(value string, fallback, min, max int) (int, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(trimmed)
	if err != nil {
		return 0, errors.New("bucket_minutes must be an integer")
	}
	if parsed < min || parsed > max {
		return 0, fmt.Errorf("bucket_minutes must be between %d and %d", min, max)
	}
	return parsed, nil
}

func parseKind(value string) searchv1.SearchKind {
	switch strings.ToLower(value) {
	case "behaviour", "behavior", "behaviour_window", "search_kind_behaviour":
		return searchv1.SearchKind_SEARCH_KIND_BEHAVIOUR
	case "sequence", "frame_sequence", "search_kind_sequence":
		return searchv1.SearchKind_SEARCH_KIND_SEQUENCE
	case "device", "search_kind_device":
		return searchv1.SearchKind_SEARCH_KIND_DEVICE
	case "cross", "search_kind_cross":
		return searchv1.SearchKind_SEARCH_KIND_CROSS
	case "proxy_event", "proxy-event", "search_kind_proxy_event":
		return searchv1.SearchKind_SEARCH_KIND_PROXY_EVENT
	case "proxy_blocked_host_window", "proxy-window", "blocked_host_window", "search_kind_proxy_blocked_host_window":
		return searchv1.SearchKind_SEARCH_KIND_PROXY_BLOCKED_HOST_WINDOW
	default:
		return searchv1.SearchKind_SEARCH_KIND_EVENT
	}
}

func shortHash(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])[:12]
}

func requestID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

func loggerWithTrace(logger zerolog.Logger, ctx context.Context) zerolog.Logger {
	span := trace.SpanFromContext(ctx)
	if span.IsRecording() {
		sc := span.SpanContext()
		if sc.HasTraceID() {
			logger = logger.With().Str("trace_id", sc.TraceID().String()).Logger()
		}
		if sc.HasSpanID() {
			logger = logger.With().Str("span_id", sc.SpanID().String()).Logger()
		}
	}
	return logger
}
