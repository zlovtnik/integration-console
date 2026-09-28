import type { Rfc3339Timestamp } from '~/utils/timestamp';

export const SEARCH_KINDS = [
  'SEARCH_KIND_UNSPECIFIED',
  'SEARCH_KIND_EVENT',
  'SEARCH_KIND_BEHAVIOUR',
  'SEARCH_KIND_SEQUENCE',
  'SEARCH_KIND_DEVICE',
  'SEARCH_KIND_CROSS',
  'SEARCH_KIND_PROXY_EVENT',
  'SEARCH_KIND_PROXY_BLOCKED_HOST_WINDOW',
] as const;

export type SearchKind = (typeof SEARCH_KINDS)[number];

export const SEARCH_MODES = [
  'SEARCH_MODE_UNSPECIFIED',
  'SEARCH_MODE_DENSE',
  'SEARCH_MODE_SPARSE',
  'SEARCH_MODE_HYBRID',
] as const;

export type SearchMode = (typeof SEARCH_MODES)[number];

export interface SearchFilters {
  bssid?: string;
  observed_ap_context_only?: boolean;
  entity_query?: string;
  location_ids?: string[];
  sensor_ids?: string[];
  ssid?: string;
  source_mac?: string;
  source_macs?: string[];
  frame_subtypes?: string[];
  observed_after?: Rfc3339Timestamp;
  observed_before?: Rfc3339Timestamp;
  threat_only?: boolean;
  handshake_only?: boolean;
  security_flags_mask?: number;
  tags?: string[];
  host?: string;
  blocked?: boolean;
  event_types?: string[];
  proxy_device_ids?: string[];
  classifications?: string[];
}

export interface SearchRequest {
  query: string;
  kind?: SearchKind;
  mode?: SearchMode;
  filters?: SearchFilters;
  top_k?: number;
  min_similarity?: number;
  session_id?: string;
}

export interface SearchResult {
  source_key: string;
  source_table: string;
  source_mac: string;
  location_id: string;
  sensor_id: string;
  observed_at?: string;
  score: number;
  cosine_similarity: number;
  keyword_rank: number;
  threat_boost: number;
  highlights: Record<string, string>;
  tags: string[];
  source_kind: string;
  bssid: string;
  ssid: string;
  frame_subtype: string;
  sequence_log_prob: number;
  boost_reasons: string[];
  detail_json: string;
  host?: string;
  blocked?: boolean;
  proxy_event_type?: string;
  proxy_device_id?: string;
  window_start?: string;
  window_end?: string;
  classification?: string;
}

export interface SearchResponse {
  report?: ReportMetadata;
  generated_at?: string;
  query_id: number;
  results: SearchResult[];
  mode_used: SearchMode;
  fallback_reason: string;
  dense_result_count: number;
  sparse_result_count: number;
  fused_result_count: number;
}

export interface ExplainResponse {
  ranking_method?: string;
  source_key: string;
  dense_score: number;
  sparse_score: number;
  fused_score: number;
  threat_boost: number;
  boost_reasons: string[];
  sequence_log_prob: number;
  sequence_tokens?: string[];
  detail_json?: string;
  /**
   * False when the record exists but ranking scores are unavailable for it
   * (for example a direct link outside a ranked search). Scores are then
   * not displayed as zeros.
   */
  scores_available?: boolean;
  /** False only when the record itself is absent. */
  found?: boolean;
  source_kind?: string;
}

export interface EntityChoice {
  kind: 'ap' | 'device';
  id: string;
  label: string;
  pinned: boolean;
  role?: 'router' | 'server';
  authorized?: boolean;
  last_seen?: string;
}

export interface EntitiesResponse {
  entities: EntityChoice[];
  next_page_cursor?: string;
}

export interface AssetAnnotation {
  kind: 'ap' | 'device';
  id: string;
  role?: 'router' | 'server';
  label?: string;
  pinned: boolean;
  revision: number;
  updated_by?: string;
  updated_at: string;
}

export interface AssetAnnotationUpdate {
  role?: 'router' | 'server' | '';
  label?: string;
  pinned?: boolean;
  expected_revision: number;
}

export interface InvestigationRequest {
  anchor?: { kind: 'ap' | 'device'; id: string };
  ap_bssid?: string;
  device_mac?: string;
  location_ids?: string[];
  sensor_ids?: string[];
  ssid?: string;
  observed_after?: Rfc3339Timestamp;
  observed_before?: Rfc3339Timestamp;
  node_limit?: number;
  edge_limit?: number;
  evidence_page?: number;
  evidence_page_size?: number;
}

export interface InvestigationEvidence {
  reference: string;
  window_start: string;
  sensor_id: string;
  location_id?: string;
  bssid: string;
  device_mac: string;
  frame_count: number;
  rssi_avg_dbm?: number;
  rssi_min_dbm?: number;
  rssi_max_dbm?: number;
  rssi_sample_count: number;
  first_observed_at: string;
  last_observed_at: string;
}

export interface InvestigationLink {
  id: string;
  source: string;
  target: string;
  type: 'observed_ap_context' | 'confirmed_identity' | 'inferred_rf_similarity';
  evidence_references?: string[];
  confidence: string;
  fresh: boolean;
}

export interface InvestigationResponse {
  anchor: { kind: string; id: string };
  nodes: GraphNode[];
  links: InvestigationLink[];
  roster: { mac: string; name: string; first_observed: string; last_observed: string; record_count: number }[];
  evidence: InvestigationEvidence[];
  evidence_page: number;
  evidence_page_size: number;
  evidence_total: number;
  signal_quality: string;
  confidence: string;
  freshness: {
    source_watermark?: string;
    projection_watermark?: string;
    coverage_status: 'complete' | 'partial' | 'stalled' | 'unknown';
    coverage_reason?: string;
  };
  focus_reason?: string;
  generated_at: string;
}

export interface SuggestFiltersResponse {
  ssids: string[];
  location_ids: string[];
  sensor_ids: string[];
  frame_subtypes: string[];
}

export type InventoryNodeKind =
  | 'device'
  | 'owner'
  | 'location_asset'
  | 'cluster'
  | 'merge_candidate'
  /** Purely visual aggregation group; never an identity cluster. */
  | 'aggregate_group';

export interface InventoryNode {
  registered?: boolean;
  first_seen?: string;
  pending_review_count?: number;
  no_ap_link_in_projection?: boolean;
  id: string;
  kind: InventoryNodeKind;
  label: string;
  mac?: string;
  known_macs?: string[];
  display_name?: string;
  owner_id?: string;
  location_id?: string;
  first_registered?: string;
  last_seen?: string;
  active: boolean;
  similarity_cluster_id?: string;
  dedup_confidence?: number;
  tags?: string[];
}

export interface InventoryEdge {
  id: string;
  source: string;
  target: string;
  kind:
    | 'owns'
    | 'located_at'
    | 'cluster_member'
    | 'merge_candidate'
    | 'candidate_pair'
    | 'same_device';
  weight?: number;
}

export interface InventoryFilters {
  registered?: boolean;
  needs_identity_review?: boolean;
  query?: string;
  source_macs?: string[];
  sensor_ids?: string[];
  observed_after?: Rfc3339Timestamp;
  observed_before?: Rfc3339Timestamp;
  sort?: 'last_observed' | 'identifier';
  grouping: 'registry' | 'cmdb' | 'similarity';
  location_ids?: string[];
  owner_ids?: string[];
  active_only?: boolean;
  min_dedup_confidence?: number;
  tags?: string[];
  limit?: number;
  /** Opt-in complete pagination; see GraphFilters.scope. */
  scope?: 'all' | 'page';
  page_cursor?: string;
  page_size?: number;
}

export interface InventoryResponse {
  report?: ReportMetadata;
  nodes: InventoryNode[];
  edges: InventoryEdge[];
  generated_at: string;
  node_count: number;
  edge_count: number;
  total_registered_count?: number;
  next_page_cursor?: string | null;
  total_node_count?: number;
  total_edge_count?: number;
  /** Total devices matching the filters, including pages not loaded yet. */
  total_device_count?: number;
}

export type MergeDecision = 'merge' | 'not_match' | 'needs_more_data';

export interface PairDetail {
  candidate_id: string;
  mac_a: string;
  mac_b: string;
  confidence: number;
  computed_at: string;
  status: string;
  evidence: Record<string, unknown>;
  projection_run_id: string;
  devices: InventoryNode[];
  decision?: string;
  decided_by?: string;
  decided_at?: string;
}

export interface MergeDecisionResponse {
  candidate_id: string;
  decision: MergeDecision;
  accepted: boolean;
  decided_by?: string;
  decided_at?: string;
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  mac?: string;
  display_name?: string;
  username?: string;
  hostname?: string;
  os_hint?: string;
  ssid?: string;
  bssid?: string;
  location_id?: string;
  sensor_id?: string;
  enabled?: boolean;
  signal_dbm?: number;
  risk_score?: number;
  score?: number;
  tags?: string[];
  cluster_size?: number;
  alert_type?: string;
  alert_severity?: string;
  alert_evidence?: Record<string, unknown>;
  reason?: string;
  occurrence_count?: number;
  probe_count?: number;
  centroid_updated_at?: string;
  centroid_sample_count?: number;
  created_at?: string;
  first_seen?: string;
  last_seen?: string;
  resolved_at?: string;
  event_source_macs?: string[];
  event_ssids?: string[];
  explain_source_key?: string;
  explain_kind?: SearchKind;
}

export type NodeKind =
  | 'device'
  | 'cluster'
  | 'ap'
  | 'client'
  | 'shadow_alert'
  | 'alert'
  | 'embedding'
  /** Purely visual aggregation group (e.g. devices near one AP); never an identity cluster. */
  | 'aggregate_group';

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  weight?: number;
  weight_basis?: string;
  label?: string;
}

export type EdgeKind =
  | 'association'
  | 'probe'
  | 'cluster_member'
  | 'shadow'
  | 'alert_ref'
  | 'rf_proximity'
  | 'roaming'
  | 'same_channel'
  | 'vendor_link';

export interface GraphResponse {
  report?: ReportMetadata;
  focus_reason?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  generated_at: string;
  node_count: number;
  edge_count: number;
  /**
   * Present only for scope: "all" requests. Opaque cursor for the next
   * page; null/absent when this is the final page.
   */
  next_page_cursor?: string | null;
  /** Present only for scope: "all" requests. */
  total_node_count?: number;
  total_edge_count?: number;
}

export interface ReportMetadata {
  scope: unknown;
  entity_grain: string;
  count_meaning: string;
  observation_start?: string;
  observation_end?: string;
  observation_basis: string;
  freshness: 'unavailable' | 'fresh' | 'stale';
  source_watermark?: string;
  projection_watermark?: string;
  loaded_rows: number;
  total_rows?: number;
  incomplete_coverage: boolean;
  unavailable_capabilities: string[];
  live: boolean;
}

export interface GraphFilters {
  location_ids?: string[];
  sensor_ids?: string[];
  source_mac?: string;
  ssid?: string;
  kinds?: NodeKind[];
  edge_kinds?: EdgeKind[];
  threat_only?: boolean;
  observed_after?: Rfc3339Timestamp;
  observed_before?: Rfc3339Timestamp;
  hops?: number;
  limit?: number;
  /**
   * Opt-in complete pagination. When "all", the response is one bounded
   * page of the complete result plus a continuation cursor and total
   * counts; the client keeps requesting pages until the cursor is null.
   */
  scope?: 'all';
  page_cursor?: string;
  page_size?: number;
}

export interface NetworkFilters {
  ssid?: string;
  source_macs?: string[];
  location_ids?: string[];
  sensor_ids?: string[];
  observed_after?: Rfc3339Timestamp;
  observed_before?: Rfc3339Timestamp;
  source_mac?: string;
  query?: string;
  ap_bssid?: string;
  page_size?: number;
  page_cursor?: string;
  include_hints?: boolean;
}
export interface NetworkResponse {
  access_points: {
    bssid: string;
    name: string;
    identifier_count: number;
    first_observed: string;
    last_observed: string;
    evidence_status: string;
  }[];
  roster: {
    mac: string;
    name: string;
    first_observed: string;
    last_observed: string;
    record_count: number;
  }[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  generated_at: string;
  next_page_cursor?: string;
  total_rows: number;
  focus_reason?: string;
  report: ReportMetadata;
}

export function isSearchKind(value: unknown): value is SearchKind {
  return (
    typeof value === 'string' && SEARCH_KINDS.includes(value as SearchKind)
  );
}

export function isSearchMode(value: unknown): value is SearchMode {
  return (
    typeof value === 'string' && SEARCH_MODES.includes(value as SearchMode)
  );
}
