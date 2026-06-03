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

export function isSearchKind(value: unknown): value is SearchKind {
  return typeof value === 'string' && SEARCH_KINDS.includes(value as SearchKind);
}

export function isSearchMode(value: unknown): value is SearchMode {
  return typeof value === 'string' && SEARCH_MODES.includes(value as SearchMode);
}
