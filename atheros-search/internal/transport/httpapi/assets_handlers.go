package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/rs/zerolog"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/assets"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/auth"
)

func registerAssetsRoutes(mux *runtime.ServeMux, tokenAuth *auth.TokenAuth, svc AssetService, logger zerolog.Logger) error {
	if err := registerJSON(mux, "GET", "/v1/entities", tokenAuth, func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
		pageSize := 0
		if raw := strings.TrimSpace(r.URL.Query().Get("page_size")); raw != "" {
			if _, err := fmt.Sscanf(raw, "%d", &pageSize); err != nil {
				writeError(w, http.StatusBadRequest, "invalid entity page_size")
				return
			}
		}
		resp, err := svc.Entities(r.Context(), r.URL.Query().Get("kind"), r.URL.Query().Get("q"), r.URL.Query().Get("page_cursor"), pageSize)
		if err != nil {
			writeError(w, httpStatusFromError(err), err.Error())
			return
		}
		writeJSON(w, http.StatusOK, resp)
	}); err != nil {
		return err
	}
	if err := registerJSON(mux, "GET", "/v1/asset-annotations/{kind}/{id}", tokenAuth, func(w http.ResponseWriter, r *http.Request, params map[string]string) {
		resp, err := svc.AssetAnnotation(r.Context(), params["kind"], params["id"])
		if err != nil {
			writeError(w, httpStatusFromError(err), err.Error())
			return
		}
		if resp == nil {
			writeError(w, http.StatusNotFound, "asset annotation not found")
			return
		}
		writeJSON(w, http.StatusOK, resp)
	}); err != nil {
		return err
	}
	if err := registerJSONRoles(mux, "PUT", "/v1/asset-annotations/{kind}/{id}", tokenAuth, []string{auth.RoleOperator, auth.RoleAdmin}, func(w http.ResponseWriter, r *http.Request, params map[string]string) {
		body, ok := readRequestBody(w, r)
		if !ok {
			return
		}
		var update assets.AssetAnnotationUpdate
		decoder := json.NewDecoder(bytes.NewReader(body))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&update); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		resp, err := svc.UpdateAssetAnnotation(r.Context(), params["kind"], params["id"], update, auth.SubjectFromContext(r.Context()))
		if err != nil {
			writeError(w, httpStatusFromError(err), err.Error())
			return
		}
		writeJSON(w, http.StatusOK, resp)
	}); err != nil {
		return err
	}
	if err := registerJSONRoles(mux, "POST", "/v1/inventory/merge-candidates/{candidate_id}/decision", tokenAuth, []string{auth.RoleOperator, auth.RoleAdmin}, func(w http.ResponseWriter, r *http.Request, params map[string]string) {
		start := time.Now()
		reqID := requestID()
		candidateID := params["candidate_id"]
		log := loggerWithTrace(logger.With().
			Str("endpoint", "/v1/inventory/merge-candidates/decision").
			Str("method", "POST").
			Str("req_id", reqID).
			Str("candidate_id_hash", shortHash(candidateID)).
			Logger(), r.Context())
		log.Info().Msg("merge decision request started")

		body, ok := readRequestBody(w, r)
		if !ok {
			log.Error().Dur("latency", time.Since(start)).Msg("merge decision failed: read body")
			return
		}
		var req struct {
			Decision string `json:"decision"`
		}
		if len(strings.TrimSpace(string(body))) > 0 {
			if err := json.Unmarshal(body, &req); err != nil {
				log.Error().Err(err).Dur("latency", time.Since(start)).Msg("merge decision failed: unmarshal")
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
		}
		resp, err := svc.MergeDecision(r.Context(), candidateID, req.Decision, auth.SubjectFromContext(r.Context()))
		if err != nil {
			log.Error().Err(err).Dur("latency", time.Since(start)).Msg("merge decision failed")
			writeError(w, httpStatusFromError(err), err.Error())
			return
		}
		log.Info().
			Dur("latency", time.Since(start)).
			Str("decision", string(resp.Decision)).
			Bool("accepted", resp.Accepted).
			Msg("merge decision completed")
		writeJSON(w, http.StatusOK, resp)
	}); err != nil {
		return err
	}
	return nil
}
