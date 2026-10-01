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
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/reporting"
)

func registerReportingRoutes(mux *runtime.ServeMux, tokenAuth *auth.TokenAuth, svc ReportingService, logger zerolog.Logger) error {
	if err := registerJSON(mux, "GET", "/v1/inventory/merge-candidates/{candidate_id}", tokenAuth, func(w http.ResponseWriter, r *http.Request, params map[string]string) {
		resp, err := svc.PairDetail(r.Context(), params["candidate_id"])
		if err != nil {
			writeError(w, httpStatusFromError(err), err.Error())
			return
		}
		writeJSON(w, http.StatusOK, resp)
	}); err != nil {
		return err
	}
	if err := registerJSON(mux, "POST", "/v1/inventory", tokenAuth, func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
		start := time.Now()
		reqID := requestID()
		log := loggerWithTrace(logger.With().Str("endpoint", "/v1/inventory").Str("method", "POST").Str("req_id", reqID).Logger(), r.Context())
		log.Info().Msg("inventory request started")

		body, ok := readRequestBody(w, r)
		if !ok {
			log.Error().Dur("latency", time.Since(start)).Msg("inventory failed: read body")
			return
		}
		var filters reporting.InventoryFilters
		if len(strings.TrimSpace(string(body))) > 0 {
			if err := json.Unmarshal(body, &filters); err != nil {
				log.Error().Err(err).Dur("latency", time.Since(start)).Msg("inventory failed: unmarshal filters")
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
		}
		log = log.With().
			Str("grouping", string(filters.Grouping)).
			Int("location_ids", len(filters.LocationIDs)).
			Int("owner_ids", len(filters.OwnerIDs)).
			Bool("active_only", filters.ActiveOnly).
			Int("tags", len(filters.Tags)).
			Int("limit", filters.Limit).
			Logger()

		resp, err := svc.Inventory(r.Context(), filters)
		if err != nil {
			log.Error().Err(err).Dur("latency", time.Since(start)).Msg("inventory failed")
			writeError(w, httpStatusFromError(err), err.Error())
			return
		}
		log.Info().
			Dur("latency", time.Since(start)).
			Int("nodes", len(resp.Nodes)).
			Int("edges", len(resp.Edges)).
			Int("total_registered", resp.TotalRegisteredCount).
			Msg("inventory completed")
		writeJSON(w, http.StatusOK, resp)
	}); err != nil {
		return err
	}
	if err := registerJSON(mux, "POST", "/v1/network-map", tokenAuth, func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
		body, ok := readRequestBody(w, r)
		if !ok {
			return
		}
		var filters reporting.NetworkFilters
		decoder := json.NewDecoder(bytes.NewReader(body))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&filters); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid network scope.")
			return
		}
		if err := decoder.Decode(&struct{}{}); err != io.EOF {
			writeError(w, http.StatusBadRequest, "Invalid network scope.")
			return
		}
		var raw map[string]json.RawMessage
		if json.Unmarshal(body, &raw) != nil {
			writeError(w, http.StatusBadRequest, "Invalid network scope.")
			return
		}
		if _, focused := raw["ap_bssid"]; focused && strings.TrimSpace(filters.APBSSID) == "" {
			writeError(w, http.StatusBadRequest, "AP focus requires a BSSID.")
			return
		}
		resp, err := svc.Network(r.Context(), filters)
		if err != nil {
			writeError(w, httpStatusFromError(err), err.Error())
			return
		}
		writeJSON(w, http.StatusOK, resp)
	}); err != nil {
		return err
	}
	if err := registerJSON(mux, "POST", "/v1/investigation", tokenAuth, func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
		body, ok := readRequestBody(w, r)
		if !ok {
			return
		}
		var request reporting.InvestigationRequest
		decoder := json.NewDecoder(bytes.NewReader(body))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid investigation scope")
			return
		}
		resp, err := svc.Investigation(r.Context(), request)
		if err != nil {
			writeError(w, httpStatusFromError(err), err.Error())
			return
		}
		writeJSON(w, http.StatusOK, resp)
	}); err != nil {
		return err
	}
	if err := registerJSON(mux, "POST", "/v1/evidence", tokenAuth, func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
		body, ok := readRequestBody(w, r)
		if !ok {
			return
		}
		var request reporting.InvestigationRequest
		decoder := json.NewDecoder(bytes.NewReader(body))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid evidence scope")
			return
		}
		resp, err := svc.Evidence(r.Context(), request)
		if err != nil {
			writeError(w, httpStatusFromError(err), err.Error())
			return
		}
		writeJSON(w, http.StatusOK, resp)
	}); err != nil {
		return err
	}
	if err := registerJSON(mux, "POST", "/v1/graph", tokenAuth, func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
		start := time.Now()
		reqID := requestID()
		log := loggerWithTrace(logger.With().Str("endpoint", "/v1/graph").Str("method", "POST").Str("req_id", reqID).Logger(), r.Context())
		log.Info().Msg("graph request started")

		body, ok := readRequestBody(w, r)
		if !ok {
			log.Error().Dur("latency", time.Since(start)).Msg("graph failed: read body")
			return
		}
		var filters reporting.GraphFilters
		if len(strings.TrimSpace(string(body))) > 0 {
			if err := json.Unmarshal(body, &filters); err != nil {
				log.Error().Err(err).Dur("latency", time.Since(start)).Msg("graph failed: unmarshal filters")
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
		}
		log = log.With().
			Int("location_ids", len(filters.LocationIDs)).
			Int("sensor_ids", len(filters.SensorIDs)).
			Bool("has_source_mac", strings.TrimSpace(filters.SourceMAC) != "").
			Bool("has_ssid", strings.TrimSpace(filters.SSID) != "").
			Int("kinds", len(filters.Kinds)).
			Bool("threat_only", filters.ThreatOnly).
			Int("limit", filters.Limit).
			Logger()

		resp, err := svc.Graph(r.Context(), filters)
		if err != nil {
			log.Error().Err(err).Dur("latency", time.Since(start)).Msg("graph failed")
			writeError(w, httpStatusFromError(err), err.Error())
			return
		}
		log.Info().
			Dur("latency", time.Since(start)).
			Int("nodes", len(resp.Nodes)).
			Int("edges", len(resp.Edges)).
			Msg("graph completed")
		writeJSON(w, http.StatusOK, resp)
	}); err != nil {
		return err
	}
	return nil
}
