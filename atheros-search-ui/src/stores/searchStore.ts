import { createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type {
  SearchFilters,
  SearchKind,
  SearchMode,
  SearchRequest,
  SearchResponse,
  SearchResult,
} from '~/api/types';

export const [query, setQuery] = createSignal('');
export const [kind, setKind] = createSignal<SearchKind>('SEARCH_KIND_EVENT');
export const [mode, setMode] = createSignal<SearchMode>('SEARCH_MODE_HYBRID');
export const [topK, setTopK] = createSignal(20);
export const [minSimilarity, setMinSimilarity] = createSignal(0);
export const [filters, setFilters] = createStore<SearchFilters>({});

export const [results, setResults] = createSignal<SearchResult[]>([]);
export const [meta, setMeta] = createStore<Partial<SearchResponse>>({});
export const [loading, setLoading] = createSignal(false);
export const [streaming, setStreaming] = createSignal(false);
export const [error, setError] = createSignal<string | null>(null);
export const [history, setHistory] = createSignal<string[]>([]);

function compactList(values: string[] | undefined): string[] | undefined {
  const next = values?.map((value) => value.trim()).filter(Boolean);
  return next && next.length > 0 ? Array.from(new Set(next)) : undefined;
}

export function cleanFilters(source: SearchFilters): SearchFilters {
  const next: SearchFilters = {};
  const locations = compactList(source.location_ids);
  const sensors = compactList(source.sensor_ids);
  const frameSubtypes = compactList(source.frame_subtypes);
  const tags = compactList(source.tags);

  if (locations) next.location_ids = locations;
  if (sensors) next.sensor_ids = sensors;
  if (frameSubtypes) next.frame_subtypes = frameSubtypes;
  if (tags) next.tags = tags;
  if (source.ssid?.trim()) next.ssid = source.ssid.trim();
  if (source.source_mac?.trim()) next.source_mac = source.source_mac.trim();
  if (source.observed_after) next.observed_after = source.observed_after;
  if (source.observed_before) next.observed_before = source.observed_before;
  if (source.threat_only) next.threat_only = true;
  if (source.handshake_only) next.handshake_only = true;
  if (typeof source.security_flags_mask === 'number' && !Number.isNaN(source.security_flags_mask)) {
    next.security_flags_mask = source.security_flags_mask;
  }

  return next;
}

export function buildSearchRequest(): SearchRequest {
  const request: SearchRequest = {
    query: query().trim(),
    kind: kind(),
    mode: mode(),
    top_k: topK(),
  };

  if (minSimilarity() > 0) {
    request.min_similarity = minSimilarity();
  }

  const nextFilters = cleanFilters(filters);
  if (Object.keys(nextFilters).length > 0) {
    request.filters = nextFilters;
  }

  return request;
}

export function pushHistory(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return;
  setHistory((items) => [trimmed, ...items.filter((item) => item !== trimmed)].slice(0, 50));
}

export function clearResults() {
  setResults([]);
  setMeta(reconcile({}));
  setError(null);
}

export function clearAllFilters() {
  setFilters(reconcile({}));
}
