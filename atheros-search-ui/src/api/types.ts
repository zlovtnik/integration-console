import type { Rfc3339Timestamp } from '~/utils/timestamp';

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
  source_macs?: string[];
  frame_subtypes?: string[];
  observed_after?: Rfc3339Timestamp;
  observed_before?: Rfc3339Timestamp;
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

export type InventoryNodeKind =
  | 'device'
  | 'owner'
  | 'location_asset'
  | 'cluster'
  | 'merge_candidate';

export interface InventoryNode {
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
    | 'same_device';
  weight?: number;
}

export interface InventoryFilters {
  grouping: 'registry' | 'cmdb' | 'similarity';
  location_ids?: string[];
  owner_ids?: string[];
  active_only?: boolean;
  min_dedup_confidence?: number;
  tags?: string[];
  limit?: number;
}

export interface InventoryResponse {
  nodes: InventoryNode[];
  edges: InventoryEdge[];
  generated_at: string;
  node_count: number;
  edge_count: number;
  total_registered_count: number;
}

export type MergeDecision = 'merge' | 'not_match' | 'needs_more_data';

export interface MergeDecisionResponse {
  candidate_id: string;
  decision: MergeDecision | 'undo_merge';
  accepted: boolean;
  undo_until?: string;
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
  observed_after?: Rfc3339Timestamp;
  observed_before?: Rfc3339Timestamp;
  limit?: number;
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
