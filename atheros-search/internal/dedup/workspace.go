package dedup

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/apperror"
)

type UIContext struct {
	Enabled       bool   `json:"enabled"`
	BetaEnabled   bool   `json:"beta_enabled"`
	RemoteOrigin  string `json:"approved_remote_origin"`
	BridgeVersion int    `json:"bridge_version"`
}

func (s *Service) UIContext() UIContext {
	return UIContext{Enabled: s.options.Enabled, BetaEnabled: s.options.Enabled, RemoteOrigin: s.options.RemoteOrigin, BridgeVersion: 1}
}

type Manifest struct {
	InstallationID       string          `json:"installation_id"`
	Namespace            string          `json:"namespace"`
	ProcessorID          string          `json:"processor_id"`
	Version              string          `json:"version"`
	OwnerTeam            string          `json:"owner_team"`
	ImplementationDigest string          `json:"implementation_digest"`
	PolicyVersion        string          `json:"policy_version"`
	ParameterSchema      json.RawMessage `json:"parameter_schema"`
	UIRemote             *Remote         `json:"ui_remote,omitempty"`
}
type Remote struct {
	ImmutableURL    string `json:"immutable_url"`
	BundleDigest    string `json:"bundle_digest"`
	HostAPIVersion  string `json:"host_api_version"`
	ParameterForm   bool   `json:"parameter_form"`
	RunInspector    bool   `json:"run_inspector"`
	ArtifactPreview bool   `json:"artifact_preview"`
}
type Catalog struct {
	Items []Manifest `json:"items"`
}
type Admission struct {
	ProcessorID      string         `json:"processor_id"`
	ProcessorVersion string         `json:"processor_version"`
	Operation        string         `json:"operation"`
	Parameters       map[string]any `json:"parameters"`
	IdempotencyKey   string         `json:"idempotency_key"`
}
type WorkspaceRun struct {
	Run
	ImplementationDigest string     `json:"implementation_digest"`
	PolicyVersion        string     `json:"policy_version"`
	DeadlineAt           string     `json:"deadline_at"`
	InputRefs            []Artifact `json:"input_refs"`
	OutputRefs           []Artifact `json:"output_refs"`
	CurrentAttempt       *Attempt   `json:"current_attempt,omitempty"`
}
type Attempt struct {
	AttemptID      string `json:"attempt_id"`
	AttemptNumber  int    `json:"attempt_number"`
	Status         string `json:"status"`
	LeaseExpiresAt string `json:"lease_expires_at"`
}
type Artifact struct {
	ArtifactID     string `json:"artifact_id"`
	InstallationID string `json:"installation_id"`
	Namespace      string `json:"namespace"`
	URI            string `json:"uri"`
	VersionID      string `json:"version_id"`
	ETag           string `json:"etag"`
	SHA256         string `json:"sha256"`
	SchemaID       string `json:"schema_id"`
	MediaType      string `json:"media_type"`
	SizeBytes      int64  `json:"size_bytes"`
	ProducerRunID  string `json:"producer_run_id"`
}
type ArtifactAccess struct {
	DownloadURL string `json:"download_url,omitempty"`
	URL         string `json:"url,omitempty"`
	ExpiresAt   string `json:"expires_at,omitempty"`
}
type Mutation struct {
	IdempotencyKey string `json:"idempotency_key,omitempty"`
}

func invalidResponse() error { return apperror.New(apperror.ErrUnavailable, "invalid DQ metadata") }
func (s *Service) sameScope(installation, namespace string) bool {
	return installation == s.options.InstallationID && namespace == s.options.Namespace
}
func (s *Service) scopedPath(path string) string {
	return path + "?" + url.Values{"installation_id": {s.options.InstallationID}, "namespace": {s.options.Namespace}}.Encode()
}
func (s *Service) scopedBody(value any) ([]byte, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, apperror.Validationf("invalid DQ request")
	}
	var body map[string]any
	if json.Unmarshal(data, &body) != nil || body == nil {
		return nil, apperror.Validationf("invalid DQ request")
	}
	body["installation_id"] = s.options.InstallationID
	body["namespace"] = s.options.Namespace
	data, err = json.Marshal(body)
	if err != nil {
		return nil, apperror.Validationf("invalid DQ request")
	}
	return data, nil
}
func (s *Service) validManifest(m Manifest) bool {
	var schema map[string]any
	if !s.sameScope(m.InstallationID, m.Namespace) || !validID(m.ProcessorID) || !validID(m.Version) || json.Unmarshal(m.ParameterSchema, &schema) != nil || schema == nil {
		return false
	}
	if m.UIRemote != nil {
		u, err := url.Parse(m.UIRemote.ImmutableURL)
		if err != nil || u.User != nil || u.Scheme+"://"+u.Host != s.options.RemoteOrigin || u.RawQuery != "" || u.Fragment != "" || u.RawPath != "" || !validSHA256(m.UIRemote.BundleDigest) || u.Path != "/"+m.ProcessorID+"/"+m.Version+"/"+m.UIRemote.BundleDigest+"/index.html" {
			return false
		}
	}
	return true
}
func (s *Service) Catalog(ctx context.Context) (*Catalog, error) {
	data, err := s.do(ctx, http.MethodGet, s.scopedPath("/v1/processors"), nil)
	if err != nil {
		return nil, err
	}
	var result Catalog
	if json.Unmarshal(data, &result) != nil || result.Items == nil {
		return nil, invalidResponse()
	}
	for _, m := range result.Items {
		if !s.validManifest(m) {
			return nil, invalidResponse()
		}
	}
	return &result, nil
}
func (s *Service) Version(ctx context.Context, id, version string) (*Manifest, error) {
	if !validID(id) || !validID(version) {
		return nil, apperror.Validationf("invalid processor version")
	}
	data, err := s.do(ctx, http.MethodGet, s.scopedPath("/v1/processor-versions/"+id+"/"+version), nil)
	if err != nil {
		return nil, err
	}
	var result Manifest
	if json.Unmarshal(data, &result) != nil || !s.validManifest(result) || result.ProcessorID != id || result.Version != version {
		return nil, invalidResponse()
	}
	return &result, nil
}
func (s *Service) workspaceRun(ctx context.Context, method, path string, body []byte, expected string) (*WorkspaceRun, error) {
	data, err := s.do(ctx, method, path, body)
	if err != nil {
		return nil, err
	}
	var result WorkspaceRun
	if json.Unmarshal(data, &result) != nil || !s.sameScope(result.InstallationID, result.Namespace) || !validID(result.RunID) || !validID(result.ProcessorID) || !validID(result.ProcessorVersion) || expected != "" && result.RunID != expected {
		return nil, invalidResponse()
	}
	for _, ref := range append(append([]Artifact{}, result.InputRefs...), result.OutputRefs...) {
		if !s.validArtifact(ref) {
			return nil, invalidResponse()
		}
	}
	return &result, nil
}
func (s *Service) AdmitProcessor(ctx context.Context, req Admission) (*WorkspaceRun, error) {
	if !validID(req.ProcessorID) || !validID(req.ProcessorVersion) || !validID(req.Operation) || !validID(req.IdempotencyKey) || req.Parameters == nil {
		return nil, apperror.Validationf("invalid invocation")
	}
	// Octopus discovers recorded merge decisions; this workspace only prepares candidates.
	if req.ProcessorID == "atheros.dedup" && req.Operation != "prepare_candidates" {
		return nil, apperror.Validationf("unsupported dedup operation")
	}
	for _, key := range []string{"installation_id", "namespace", "execution_mode"} {
		if _, ok := req.Parameters[key]; ok {
			return nil, apperror.Validationf("deployment scope cannot be overridden")
		}
	}
	scope, ok := req.Parameters["authorized_scope"].(string)
	if !ok || scope != "*" && !validID(scope) {
		return nil, apperror.Validationf("authorized_scope is required")
	}
	body, err := s.scopedBody(req)
	if err != nil {
		return nil, err
	}
	run, err := s.workspaceRun(ctx, http.MethodPost, "/v1/runs", body, "")
	if err == nil && (run.ProcessorID != req.ProcessorID || run.ProcessorVersion != req.ProcessorVersion || run.Operation != req.Operation) {
		return nil, invalidResponse()
	}
	return run, err
}
func (s *Service) Inspect(ctx context.Context, id string) (*WorkspaceRun, error) {
	if !validID(id) {
		return nil, apperror.Validationf("invalid run_id")
	}
	return s.workspaceRun(ctx, http.MethodGet, s.scopedPath("/v1/runs/"+id), nil, id)
}
func (s *Service) Cancel(ctx context.Context, id string) (*WorkspaceRun, error) {
	if !validID(id) {
		return nil, apperror.Validationf("invalid run_id")
	}
	body, err := s.scopedBody(Mutation{})
	if err != nil {
		return nil, err
	}
	return s.workspaceRun(ctx, http.MethodPost, "/v1/runs/"+id+"/cancel", body, id)
}
func (s *Service) Replay(ctx context.Context, id, key string) (*WorkspaceRun, error) {
	if !validID(id) || !validID(key) {
		return nil, apperror.Validationf("invalid replay identity")
	}
	source, err := s.Inspect(ctx, id)
	if err != nil {
		return nil, err
	}
	if source.ProcessorID == "atheros.dedup" && source.Operation != "prepare_candidates" {
		return nil, apperror.Validationf("unsupported dedup operation")
	}
	body, err := s.scopedBody(Mutation{IdempotencyKey: key})
	if err != nil {
		return nil, err
	}
	result, err := s.workspaceRun(ctx, http.MethodPost, "/v1/runs/"+id+"/replay", body, "")
	if err == nil && (result.RunID == id || result.ProcessorID != source.ProcessorID || result.ProcessorVersion != source.ProcessorVersion || result.Operation != source.Operation) {
		return nil, invalidResponse()
	}
	return result, err
}
func (s *Service) validArtifact(ref Artifact) bool {
	return s.sameScope(ref.InstallationID, ref.Namespace) && validID(ref.ArtifactID) && validID(ref.ProducerRunID) && ref.VersionID != "" && ref.VersionID != "null" && ref.SizeBytes >= 0 && validSHA256(ref.SHA256)
}
func validSHA256(value string) bool {
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == 32
}
func (s *Service) Artifact(ctx context.Context, id string) (*Artifact, error) {
	if !validID(id) {
		return nil, apperror.Validationf("invalid artifact_id")
	}
	data, err := s.do(ctx, http.MethodGet, s.scopedPath("/v1/artifacts/"+id), nil)
	if err != nil {
		return nil, err
	}
	var result Artifact
	if json.Unmarshal(data, &result) != nil || !s.validArtifact(result) || result.ArtifactID != id {
		return nil, invalidResponse()
	}
	return &result, nil
}
func (s *Service) Access(ctx context.Context, id string) (*ArtifactAccess, error) {
	// Authorize exact metadata before requesting access; the manager also checks its producer run.
	if _, err := s.Artifact(ctx, id); err != nil {
		return nil, err
	}
	body, err := s.scopedBody(Mutation{})
	if err != nil {
		return nil, err
	}
	data, err := s.do(ctx, http.MethodPost, "/v1/artifacts/"+id+"/access", body)
	if err != nil {
		return nil, err
	}
	var result ArtifactAccess
	if json.Unmarshal(data, &result) != nil {
		return nil, invalidResponse()
	}
	raw := result.DownloadURL
	if raw == "" {
		raw = result.URL
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.Fragment != "" || u.Scheme != "https" && (u.Scheme != "http" || u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1") {
		return nil, invalidResponse()
	}
	return &result, nil
}
