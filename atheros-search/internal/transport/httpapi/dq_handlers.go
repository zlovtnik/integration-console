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

func dqBody(w http.ResponseWriter, r *http.Request, out any) bool {
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 65536))
	if err != nil {
		writeError(w, httpStatusFromError(err), "invalid DQ body")
		return false
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) || d.Decode(out) != nil || d.Decode(new(any)) != io.EOF {
		writeError(w, 400, "invalid DQ request")
		return false
	}
	return true
}

func registerDQRoutes(mux *runtime.ServeMux, tokenAuth *auth.TokenAuth, svc DQService) error {
	type route struct {
		method, path string
		mutation     bool
		handle       func(http.ResponseWriter, *http.Request, map[string]string) (any, error)
	}
	routes := []route{
		{"GET", "/v1/dq/context", false, func(_ http.ResponseWriter, _ *http.Request, _ map[string]string) (any, error) {
			if svc == nil {
				return dedup.UIContext{BridgeVersion: 1}, nil
			}
			return svc.UIContext(), nil
		}},
		{"GET", "/v1/dq/processors", false, func(_ http.ResponseWriter, r *http.Request, _ map[string]string) (any, error) {
			return svc.Catalog(r.Context())
		}},
		{"GET", "/v1/dq/processor-versions/{processor_id}/{version}", false, func(_ http.ResponseWriter, r *http.Request, p map[string]string) (any, error) {
			return svc.Version(r.Context(), p["processor_id"], p["version"])
		}},
		{"POST", "/v1/dq/runs", true, func(w http.ResponseWriter, r *http.Request, _ map[string]string) (any, error) {
			var req dedup.Admission
			if !dqBody(w, r, &req) {
				return nil, nil
			}
			return svc.AdmitProcessor(r.Context(), req)
		}},
		{"GET", "/v1/dq/runs/{run_id}", false, func(_ http.ResponseWriter, r *http.Request, p map[string]string) (any, error) {
			return svc.Inspect(r.Context(), p["run_id"])
		}},
		{"POST", "/v1/dq/runs/{run_id}/cancel", true, func(w http.ResponseWriter, r *http.Request, p map[string]string) (any, error) {
			var req struct{}
			if !dqBody(w, r, &req) {
				return nil, nil
			}
			return svc.Cancel(r.Context(), p["run_id"])
		}},
		{"POST", "/v1/dq/runs/{run_id}/replay", true, func(w http.ResponseWriter, r *http.Request, p map[string]string) (any, error) {
			var req dedup.Mutation
			if !dqBody(w, r, &req) {
				return nil, nil
			}
			return svc.Replay(r.Context(), p["run_id"], req.IdempotencyKey)
		}},
		{"GET", "/v1/dq/artifacts/{artifact_id}", false, func(_ http.ResponseWriter, r *http.Request, p map[string]string) (any, error) {
			return svc.Artifact(r.Context(), p["artifact_id"])
		}},
		{"POST", "/v1/dq/artifacts/{artifact_id}/access", false, func(w http.ResponseWriter, r *http.Request, p map[string]string) (any, error) {
			var req struct{}
			if !dqBody(w, r, &req) {
				return nil, nil
			}
			return svc.Access(r.Context(), p["artifact_id"])
		}},
	}
	for _, entry := range routes {
		roles := []string{auth.RoleViewer, auth.RoleOperator, auth.RoleAdmin}
		if entry.mutation {
			roles = []string{auth.RoleOperator, auth.RoleAdmin}
		}
		if err := registerJSONRoles(mux, entry.method, entry.path, tokenAuth, roles, func(w http.ResponseWriter, r *http.Request, p map[string]string) {
			w.Header().Set("Cache-Control", "no-store")
			if r.URL.RawQuery != "" {
				writeError(w, 400, "DQ query overrides are not allowed")
				return
			}
			if entry.path != "/v1/dq/context" && (svc == nil || !svc.UIContext().Enabled) {
				writeError(w, 403, "DQ is disabled")
				return
			}
			value, err := entry.handle(w, r, p)
			if err != nil {
				writeError(w, httpStatusFromError(err), err.Error())
				return
			}
			if value != nil {
				status := 200
				if entry.path == "/v1/dq/runs" || entry.path == "/v1/dq/runs/{run_id}/replay" {
					status = 202
				}
				writeJSON(w, status, value)
			}
		}); err != nil {
			return err
		}
	}
	return nil
}
