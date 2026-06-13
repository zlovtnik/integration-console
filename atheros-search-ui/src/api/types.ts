export const SEARCH_KINDS = [
  'SEARCH_KIND_UNSPECIFIED',
  'SEARCH_KIND_EVENT',
  'SEARCH_KIND_BEHAVIOUR',
  'SEARCH_KIND_SEQUENCE',
  'SEARCH_KIND_DEVICE',
  'SEARCH_KIND_CROSS',
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
  location_ids?: string[];
  sensor_ids?: string[];
  ssid?: string;
  source_mac?: string;
  frame_subtypes?: string[];
  observed_after?: string;
  observed_before?: string;
  threat_only?: boolean;
  handshake_only?: boolean;
  security_flags_mask?: number;
  tags?: string[];
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
}

export interface SearchResponse {
  query_id: number;
  results: SearchResult[];
  mode_used: SearchMode;
  fallback_reason: string;
  dense_result_count: number;
  sparse_result_count: number;
  fused_result_count: number;
}

export interface ExplainResponse {
  source_key: string;
  dense_score: number;
  sparse_score: number;
  fused_score: number;
  threat_boost: number;
  boost_reasons: string[];
  sequence_log_prob: number;
  sequence_tokens?: string[];
  detail_json?: string;
}

export interface SuggestFiltersResponse {
  ssids: string[];
  location_ids: string[];
  sensor_ids: string[];
  frame_subtypes: string[];
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
  reason?: string;
  occurrence_count?: number;
  probe_count?: number;
  centroid_updated_at?: string;
  centroid_sample_count?: number;
  created_at?: string;
  first_seen?: string;
  last_seen?: string;
  resolved_at?: string;
}

export type NodeKind =
  | 'device'
  | 'cluster'
  | 'ap'
  | 'client'
  | 'shadow_alert'
  | 'alert'
  | 'embedding';

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  weight?: number;
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
  nodes: GraphNode[];
  edges: GraphEdge[];
  generated_at: string;
  node_count: number;
  edge_count: number;
}

export interface GraphFilters {
  location_ids?: string[];
  sensor_ids?: string[];
  source_mac?: string;
  ssid?: string;
  kinds?: NodeKind[];
  threat_only?: boolean;
  observed_after?: string;
  observed_before?: string;
  limit?: number;
}

export function isSearchKind(value: unknown): value is SearchKind {
  return typeof value === 'string' && SEARCH_KINDS.includes(value as SearchKind);
}

export function isSearchMode(value: unknown): value is SearchMode {
  return typeof value === 'string' && SEARCH_MODES.includes(value as SearchMode);
}
