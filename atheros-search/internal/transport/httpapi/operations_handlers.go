package httpapi

import (
	"net/http"

	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/auth"
)

func registerOperationsRoutes(mux *runtime.ServeMux, tokenAuth *auth.TokenAuth, service OperationsService) error {
	if service == nil {
		return nil
	}
	if err := registerJSON(mux, "GET", "/v1/operations/pipeline", tokenAuth, func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, service.Pipeline(r.Context()))
	}); err != nil {
		return err
	}
	if err := registerJSON(mux, "GET", "/v1/operations/sources", tokenAuth, func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, service.Sources(r.Context()))
	}); err != nil {
		return err
	}
	return registerJSONRoles(mux, "GET", "/v1/operations/proxy/live", tokenAuth, []string{auth.RoleOperator, auth.RoleAdmin}, func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, service.ProxyLive(r.Context()))
	})
}
