package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"

	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/auth"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/dedup"
)

func registerDedupRoutes(mux *runtime.ServeMux, tokenAuth *auth.TokenAuth, svc DedupService) error {
	if err := registerJSONRoles(mux, "POST", "/v1/dedup/runs", tokenAuth, []string{auth.RoleOperator, auth.RoleAdmin}, func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
		if svc == nil {
			writeError(w, http.StatusForbidden, "DQ dedup beta is disabled")
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 65536))
		if err != nil {
			writeError(w, httpStatusFromError(err), "invalid dedup request body")
			return
		}
		var request dedup.Request
		decoder := json.NewDecoder(bytes.NewReader(body))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid dedup request")
			return
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			writeError(w, http.StatusBadRequest, "dedup request must contain one JSON object")
			return
		}
		run, err := svc.Admit(r.Context(), request)
		if err != nil {
			writeError(w, httpStatusFromError(err), err.Error())
			return
		}
		writeJSON(w, http.StatusAccepted, run)
	}); err != nil {
		return err
	}
	return registerJSON(mux, "GET", "/v1/dedup/runs/{run_id}", tokenAuth, func(w http.ResponseWriter, r *http.Request, params map[string]string) {
		if svc == nil {
			writeError(w, http.StatusForbidden, "DQ dedup beta is disabled")
			return
		}
		run, err := svc.Run(r.Context(), params["run_id"])
		if err != nil {
			writeError(w, httpStatusFromError(err), err.Error())
			return
		}
		writeJSON(w, http.StatusOK, run)
	})
}
