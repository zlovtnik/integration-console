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
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/savedviews"
)

// savedViewsOwner returns the immutable subject that owns personal saved
// views. Static-token and auth-disabled deployments have no stable user
// identity, so they report saved views as unavailable instead of sharing
// one synthetic owner across callers.
func savedViewsOwner(r *http.Request) string {
	identity := auth.IdentityFromContext(r.Context())
	if identity.Kind != auth.IdentityJWT {
		return ""
	}
	return strings.TrimSpace(identity.Subject)
}

// registerSavedViews mounts the authenticated personal saved-view contract.
// Owner subjects are never logged or serialized in responses.
func registerSavedViews(mux *runtime.ServeMux, tokenAuth *auth.TokenAuth, svc SavedViewService, logger zerolog.Logger) error {
	writeUnavailable := func(w http.ResponseWriter) {
		writeError(w, http.StatusForbidden, savedviews.ErrSavedViewUnavailable.Error())
	}

	if err := registerJSON(mux, "GET", "/v1/saved-views", tokenAuth, func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
		start := time.Now()
		owner := savedViewsOwner(r)
		if owner == "" {
			writeUnavailable(w)
			return
		}
		views, err := svc.ListSavedViews(r.Context(), owner, r.URL.Query().Get("surface"))
		if err != nil {
			log := loggerWithTrace(logger.With().Str("endpoint", "/v1/saved-views").Str("method", "GET").Logger(), r.Context())
			log.Error().Err(err).Dur("latency", time.Since(start)).Msg("list saved views failed")
			writeError(w, httpStatusFromError(err), err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"views": views})
	}); err != nil {
		return err
	}

	if err := registerJSON(mux, "POST", "/v1/saved-views", tokenAuth, func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
		start := time.Now()
		owner := savedViewsOwner(r)
		if owner == "" {
			writeUnavailable(w)
			return
		}
		body, ok := readRequestBody(w, r)
		if !ok {
			return
		}
		var input savedviews.SavedViewCreate
		decoder := json.NewDecoder(bytes.NewReader(body))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&input); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := decoder.Decode(&struct{}{}); err != io.EOF {
			writeError(w, http.StatusBadRequest, "invalid saved view payload")
			return
		}
		view, err := svc.CreateSavedView(r.Context(), owner, input)
		if err != nil {
			log := loggerWithTrace(logger.With().Str("endpoint", "/v1/saved-views").Str("method", "POST").Logger(), r.Context())
			log.Error().Err(err).Dur("latency", time.Since(start)).Msg("create saved view failed")
			writeError(w, httpStatusFromError(err), err.Error())
			return
		}
		log := loggerWithTrace(logger.With().Str("endpoint", "/v1/saved-views").Str("method", "POST").Logger(), r.Context())
		log.Info().Dur("latency", time.Since(start)).Msg("saved view created")
		writeJSON(w, http.StatusCreated, view)
	}); err != nil {
		return err
	}

	if err := registerJSON(mux, "PUT", "/v1/saved-views/{id}", tokenAuth, func(w http.ResponseWriter, r *http.Request, params map[string]string) {
		start := time.Now()
		owner := savedViewsOwner(r)
		if owner == "" {
			writeUnavailable(w)
			return
		}
		body, ok := readRequestBody(w, r)
		if !ok {
			return
		}
		var input savedviews.SavedViewUpdate
		decoder := json.NewDecoder(bytes.NewReader(body))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&input); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := decoder.Decode(&struct{}{}); err != io.EOF {
			writeError(w, http.StatusBadRequest, "invalid saved view payload")
			return
		}
		view, err := svc.UpdateSavedView(r.Context(), owner, params["id"], input)
		if err != nil {
			log := loggerWithTrace(logger.With().Str("endpoint", "/v1/saved-views/{id}").Str("method", "PUT").Logger(), r.Context())
			log.Error().Err(err).Dur("latency", time.Since(start)).Msg("update saved view failed")
			writeError(w, httpStatusFromError(err), err.Error())
			return
		}
		writeJSON(w, http.StatusOK, view)
	}); err != nil {
		return err
	}

	if err := registerJSON(mux, "DELETE", "/v1/saved-views/{id}", tokenAuth, func(w http.ResponseWriter, r *http.Request, params map[string]string) {
		owner := savedViewsOwner(r)
		if owner == "" {
			writeUnavailable(w)
			return
		}
		if err := svc.DeleteSavedView(r.Context(), owner, params["id"]); err != nil {
			writeError(w, httpStatusFromError(err), err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}); err != nil {
		return err
	}
	return nil
}
