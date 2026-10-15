// Package dedup delegates opt-in processing to DQ without owning run state or SQL.
package dedup

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/apperror"
)

const maxControlBytes = 65536

type Request struct {
	Operation        string `json:"operation"`
	ProcessorVersion string `json:"processor_version,omitempty"`
	AuthorizedScope  string `json:"authorized_scope"`
	SnapshotRevision string `json:"snapshot_revision,omitempty"`
	PolicyVersion    string `json:"policy_version"`
	MaxCandidates    int    `json:"max_candidates"`
	CandidateID      string `json:"candidate_id,omitempty"`
	IdempotencyKey   string `json:"idempotency_key"`
}

type Run struct {
	RunID             string          `json:"run_id"`
	InstallationID    string          `json:"installation_id"`
	Namespace         string          `json:"namespace"`
	ProcessorID       string          `json:"processor_id"`
	ProcessorVersion  string          `json:"processor_version"`
	Operation         string          `json:"operation"`
	Parameters        json.RawMessage `json:"parameters"`
	Status            string          `json:"status"`
	StateRevision     int64           `json:"state_revision"`
	ExecutionMode     string          `json:"execution_mode"`
	ProjectionApplied bool            `json:"projection_applied"`
	CreatedAt         string          `json:"created_at"`
	CompletedAt       string          `json:"completed_at,omitempty"`
	ErrorCode         string          `json:"error_code,omitempty"`
	SanitizedError    string          `json:"sanitized_error,omitempty"`
}

type Options struct {
	Enabled        bool
	ManagerURL     string
	ServiceToken   string
	InstallationID string
	Namespace      string
	Timeout        time.Duration
	RemoteOrigin   string
}

type Service struct {
	options Options
	client  *http.Client
}

func New(options Options) *Service {
	return &Service{options: options, client: &http.Client{
		Timeout: options.Timeout,
		// A service credential must never follow a redirected manager URL.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

func validID(value string) bool {
	if value == "" || len(value) > 200 || value == "." || value == ".." {
		return false
	}
	for _, ch := range value {
		if ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || ch == '-' || ch == '_' || ch == '.' {
			continue
		}
		return false
	}
	return true
}

func (s *Service) Admit(ctx context.Context, request Request) (*Run, error) {
	if !s.options.Enabled {
		return nil, apperror.New(apperror.ErrForbidden, "DQ dedup beta is disabled")
	}
	if request.Operation != "prepare_candidates" && request.Operation != "reconcile_decision" {
		return nil, apperror.Validationf("unsupported dedup operation")
	}
	if request.AuthorizedScope != "*" && !validID(request.AuthorizedScope) {
		return nil, apperror.Validationf("authorized_scope is required")
	}
	if !validID(request.PolicyVersion) || !validID(request.IdempotencyKey) || request.MaxCandidates < 1 || request.MaxCandidates > 1000 {
		return nil, apperror.Validationf("policy_version, idempotency_key and max_candidates (1..1000) are required")
	}
	if request.ProcessorVersion != "" && !validID(request.ProcessorVersion) || len(request.SnapshotRevision) > 200 || request.CandidateID != "" && !validID(request.CandidateID) {
		return nil, apperror.Validationf("invalid version or source revision")
	}
	if request.Operation == "reconcile_decision" && request.CandidateID == "" {
		return nil, apperror.Validationf("candidate_id is required for reconciliation")
	}
	parameters := map[string]any{"authorized_scope": request.AuthorizedScope, "policy_version": request.PolicyVersion, "max_candidates": request.MaxCandidates}
	if request.SnapshotRevision != "" {
		parameters["snapshot_revision"] = request.SnapshotRevision
	}
	if request.CandidateID != "" {
		parameters["candidate_id"] = request.CandidateID
	}
	body, err := json.Marshal(map[string]any{
		"installation_id": s.options.InstallationID, "namespace": s.options.Namespace,
		"processor_id": "atheros.dedup", "processor_version": request.ProcessorVersion,
		"operation": request.Operation, "parameters": parameters, "idempotency_key": request.IdempotencyKey,
	})
	if err != nil {
		return nil, apperror.New(apperror.ErrValidation, "invalid dedup parameters")
	}
	return s.request(ctx, http.MethodPost, "/v1/runs", body)
}

func (s *Service) Run(ctx context.Context, runID string) (*Run, error) {
	if !s.options.Enabled {
		return nil, apperror.New(apperror.ErrForbidden, "DQ dedup beta is disabled")
	}
	if !validID(runID) {
		return nil, apperror.Validationf("invalid run_id")
	}
	query := url.Values{"installation_id": {s.options.InstallationID}, "namespace": {s.options.Namespace}}
	run, err := s.request(ctx, http.MethodGet, "/v1/runs/"+url.PathEscape(runID)+"?"+query.Encode(), nil)
	if err == nil && run.RunID != runID {
		return nil, apperror.New(apperror.ErrUnavailable, "invalid DQ status response")
	}
	return run, err
}

func (s *Service) request(ctx context.Context, method, path string, body []byte) (*Run, error) {
	data, err := s.do(ctx, method, path, body)
	if err != nil {
		return nil, err
	}
	var run Run
	if err := json.Unmarshal(data, &run); err != nil || !validID(run.RunID) || run.ProcessorID != "atheros.dedup" || run.InstallationID != s.options.InstallationID || run.Namespace != s.options.Namespace {
		return nil, apperror.New(apperror.ErrUnavailable, "invalid DQ status response")
	}
	return &run, nil
}

func (s *Service) do(ctx context.Context, method, path string, body []byte) ([]byte, error) {
	if !s.options.Enabled {
		return nil, apperror.New(apperror.ErrForbidden, "DQ beta is disabled")
	}
	if len(body) > maxControlBytes {
		return nil, apperror.Validationf("DQ metadata exceeds 64 KiB")
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(s.options.ManagerURL, "/")+path, bytes.NewReader(body))
	if err != nil {
		return nil, apperror.New(apperror.ErrUnavailable, "DQ manager is unavailable")
	}
	req.Header.Set("Authorization", "Bearer "+s.options.ServiceToken)
	req.Header.Set("Content-Type", "application/json")
	response, err := s.client.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			return nil, err
		}
		return nil, apperror.New(apperror.ErrUnavailable, "DQ manager is unavailable")
	}
	defer func() {
		// Only bounded metadata is consumed; a close error cannot change its outcome.
		_ = response.Body.Close()
	}()
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusAccepted {
		switch response.StatusCode {
		case http.StatusBadRequest, http.StatusUnprocessableEntity:
			return nil, apperror.New(apperror.ErrValidation, "DQ rejected the dedup parameters")
		case http.StatusUnauthorized, http.StatusForbidden:
			return nil, apperror.New(apperror.ErrForbidden, "DQ access is unavailable for this scope")
		case http.StatusNotFound:
			return nil, apperror.New(apperror.ErrNotFound, "DQ run or processor version not found")
		case http.StatusConflict:
			return nil, apperror.New(apperror.ErrConflict, "DQ invocation identity conflicts with an existing run")
		case http.StatusTooManyRequests:
			return nil, apperror.New(apperror.ErrCapacity, "DQ admission capacity is exhausted")
		default:
			return nil, apperror.New(apperror.ErrUnavailable, "DQ manager is unavailable")
		}
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxControlBytes+1))
	if err != nil || len(data) > maxControlBytes {
		return nil, apperror.New(apperror.ErrUnavailable, "invalid DQ status response")
	}
	if !json.Valid(data) {
		return nil, apperror.New(apperror.ErrUnavailable, "invalid DQ status response")
	}
	return data, nil
}
