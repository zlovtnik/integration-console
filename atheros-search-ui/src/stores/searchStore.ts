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

const HISTORY_STORAGE_KEY = 'atheros-search.history';
const SESSION_STORAGE_KEY = 'atheros-search.session-id';
const HISTORY_LIMIT = 50;
const DEFAULT_KIND: SearchKind = 'SEARCH_KIND_EVENT';
const DEFAULT_MODE: SearchMode = 'SEARCH_MODE_HYBRID';
let fallbackSessionId: string | null = null;

function readSessionList(key: string): string[] {
  if (typeof window === 'undefined') return [];

  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(key) ?? '[]',
    ) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function writeSessionList(key: string, values: string[]) {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(
      key,
      JSON.stringify(values.slice(0, HISTORY_LIMIT)),
    );
  } catch {
    // Storage can be disabled by browser policy.
  }
}

function createFallbackSessionId(): string {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function cachedFallbackSessionId(): string {
  fallbackSessionId ||= createFallbackSessionId();
  return fallbackSessionId;
}

function tabSessionId(): string {
  if (typeof window === 'undefined') return cachedFallbackSessionId();

  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const next =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : createFallbackSessionId();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, next);
    return next;
  } catch {
    return cachedFallbackSessionId();
  }
}

export function normalizeSearchKind(value: SearchKind): SearchKind {
  return value === 'SEARCH_KIND_UNSPECIFIED' ? DEFAULT_KIND : value;
}

export function normalizeSearchMode(value: SearchMode): SearchMode {
  return value === 'SEARCH_MODE_UNSPECIFIED' ? DEFAULT_MODE : value;
}

export function isWildcardAllQuery(value: string): boolean {
  const trimmed = value.trim();
  return trimmed !== '' && trimmed.replace(/[*%]/g, '').trim() === '';
}

export const [query, setQuery] = createSignal('');
export const [kind, setKind] = createSignal<SearchKind>(DEFAULT_KIND);
export const [mode, setMode] = createSignal<SearchMode>(DEFAULT_MODE);
export const [topK, setTopK] = createSignal(20);
export const [minSimilarity, setMinSimilarity] = createSignal(0);
export const [filters, setFilters] = createStore<SearchFilters>({});

export const [results, setResults] = createStore<SearchResult[]>([]);
export const [meta, setMeta] = createStore<Partial<SearchResponse>>({});
export const [loading, setLoading] = createSignal(false);
export const [streaming, setStreaming] = createSignal(false);
export const [error, setError] = createSignal<string | null>(null);
export const [history, setHistory] = createSignal<string[]>(
  readSessionList(HISTORY_STORAGE_KEY),
);

function compactList(values: string[] | undefined): string[] | undefined {
  const next = values?.map((value) => value.trim()).filter(Boolean);
  return next && next.length > 0 ? Array.from(new Set(next)) : undefined;
}

function compactSourceMacs(source: SearchFilters): string[] | undefined {
  return compactList([source.source_mac ?? '', ...(source.source_macs ?? [])]);
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
  const sourceMacs = compactSourceMacs(source);
  if (sourceMacs?.length === 1) {
    const [sourceMac] = sourceMacs;
    if (sourceMac) next.source_mac = sourceMac;
  } else if (sourceMacs && sourceMacs.length > 1) {
    next.source_macs = sourceMacs;
  }
  if (source.observed_after) next.observed_after = source.observed_after;
  if (source.observed_before) next.observed_before = source.observed_before;
  if (source.threat_only) next.threat_only = true;
  if (source.handshake_only) next.handshake_only = true;
  if (
    typeof source.security_flags_mask === 'number' &&
    !Number.isNaN(source.security_flags_mask)
  ) {
    next.security_flags_mask = source.security_flags_mask;
  }

  return next;
}

export function buildSearchRequest(): SearchRequest {
  const trimmedQuery = query().trim();
  const wildcardAll = isWildcardAllQuery(trimmedQuery);
  const request: SearchRequest = {
    query: trimmedQuery,
    kind: normalizeSearchKind(kind()),
    mode: wildcardAll ? 'SEARCH_MODE_SPARSE' : normalizeSearchMode(mode()),
    top_k: topK(),
    session_id: tabSessionId(),
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
  setHistory((items) => {
    const next = [trimmed, ...items.filter((item) => item !== trimmed)].slice(
      0,
      HISTORY_LIMIT,
    );
    writeSessionList(HISTORY_STORAGE_KEY, next);
    return next;
  });
}

export function replaceResults(next: SearchResult[]) {
  setResults(reconcile(next));
}

export function appendResult(result: SearchResult) {
  setResults(results.length, result);
}

export function clearResults() {
  replaceResults([]);
  setMeta(reconcile({}));
  setError(null);
}

export function clearAllFilters() {
  setFilters(reconcile({}));
}
