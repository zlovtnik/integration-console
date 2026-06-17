import { env } from '~/env';
import type {
  ExplainResponse,
  GraphFilters,
  GraphResponse,
  SearchRequest,
  SearchResponse,
  SearchResult,
  SuggestFiltersResponse,
} from './types';

const DEFAULT_TIMEOUT_MS = 30_000;

type ApiErrorPayload = {
  code?: string;
  message?: string;
};

type RawSearchResult = Partial<SearchResult> & {
  sourceKey?: unknown;
  sourceTable?: unknown;
  sourceMac?: unknown;
  locationId?: unknown;
  sensorId?: unknown;
  observedAt?: unknown;
  cosineSimilarity?: unknown;
  keywordRank?: unknown;
  threatBoost?: unknown;
  sourceKind?: unknown;
  frameSubtype?: unknown;
  sequenceLogProb?: unknown;
  boostReasons?: unknown;
  detailJson?: unknown;
};

type RawSearchResponse = Omit<Partial<SearchResponse>, 'results'> & {
  queryId?: unknown;
  modeUsed?: unknown;
  fallbackReason?: unknown;
  denseResultCount?: unknown;
  sparseResultCount?: unknown;
  fusedResultCount?: unknown;
  results?: unknown;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public body?: unknown,
    public rawBody?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function buildUrl(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }

  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

function parseApiErrorBody(rawBody: string): ApiErrorPayload | undefined {
  if (!rawBody.trim()) return undefined;

  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const payload = parsed as Record<string, unknown>;
    const result: ApiErrorPayload = {};
    if (typeof payload.code === 'string') result.code = payload.code;
    if (typeof payload.message === 'string') result.message = payload.message;
    if (typeof payload.error === 'string') result.message ??= payload.error;
    return result;
  } catch {
    return undefined;
  }
}

export async function apiErrorFromResponse(
  response: Response,
): Promise<ApiError> {
  const rawBody = await response.text().catch(() => '');
  const parsed = parseApiErrorBody(rawBody);
  return new ApiError(
    response.status,
    parsed?.message || rawBody || response.statusText,
    parsed?.code,
    parsed,
    rawBody,
  );
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string') return value;
  }
  return '';
}

function firstNumber(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function stringRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function detailJson(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null)
      return JSON.stringify(value);
  }
  return '';
}

export function normalizeSearchResult(raw: RawSearchResult): SearchResult {
  const result: SearchResult = {
    source_key: firstString(raw.source_key, raw.sourceKey),
    source_table: firstString(raw.source_table, raw.sourceTable),
    source_mac: firstString(raw.source_mac, raw.sourceMac),
    location_id: firstString(raw.location_id, raw.locationId),
    sensor_id: firstString(raw.sensor_id, raw.sensorId),
    score: firstNumber(raw.score),
    cosine_similarity: firstNumber(raw.cosine_similarity, raw.cosineSimilarity),
    keyword_rank: firstNumber(raw.keyword_rank, raw.keywordRank),
    threat_boost: firstNumber(raw.threat_boost, raw.threatBoost),
    highlights: stringRecord(raw.highlights),
    tags: stringArray(raw.tags),
    source_kind: firstString(raw.source_kind, raw.sourceKind),
    bssid: firstString(raw.bssid),
    ssid: firstString(raw.ssid),
    frame_subtype: firstString(raw.frame_subtype, raw.frameSubtype),
    sequence_log_prob: firstNumber(raw.sequence_log_prob, raw.sequenceLogProb),
    boost_reasons: stringArray(raw.boost_reasons ?? raw.boostReasons),
    detail_json: detailJson(raw.detail_json, raw.detailJson),
  };
  const observedAt = firstString(raw.observed_at, raw.observedAt);
  if (observedAt) result.observed_at = observedAt;
  return result;
}

export function normalizeSearchMeta(
  raw: RawSearchResponse,
): Partial<SearchResponse> {
  const meta: Partial<SearchResponse> = {};
  const modeUsed = firstString(raw.mode_used, raw.modeUsed);
  const fallbackReason = firstString(raw.fallback_reason, raw.fallbackReason);
  const denseResultCount = firstNumber(
    raw.dense_result_count,
    raw.denseResultCount,
  );
  const sparseResultCount = firstNumber(
    raw.sparse_result_count,
    raw.sparseResultCount,
  );
  const fusedResultCount = firstNumber(
    raw.fused_result_count,
    raw.fusedResultCount,
  );
  const queryId = firstNumber(raw.query_id, raw.queryId);

  if (modeUsed) meta.mode_used = modeUsed as SearchResponse['mode_used'];
  if (fallbackReason) meta.fallback_reason = fallbackReason;
  if (denseResultCount) meta.dense_result_count = denseResultCount;
  if (sparseResultCount) meta.sparse_result_count = sparseResultCount;
  if (fusedResultCount) meta.fused_result_count = fusedResultCount;
  if (queryId) meta.query_id = queryId;

  return meta;
}

export function normalizeSearchResponse(
  raw: RawSearchResponse,
): SearchResponse {
  const meta = normalizeSearchMeta(raw);
  const rawResults = Array.isArray(raw.results) ? raw.results : [];

  return {
    query_id: meta.query_id ?? 0,
    results: rawResults.map((result) =>
      normalizeSearchResult(result as RawSearchResult),
    ),
    mode_used: meta.mode_used ?? 'SEARCH_MODE_UNSPECIFIED',
    fallback_reason: meta.fallback_reason ?? '',
    dense_result_count: meta.dense_result_count ?? 0,
    sparse_result_count: meta.sparse_result_count ?? 0,
    fused_result_count: meta.fused_result_count ?? 0,
  };
}

function abortSignalWithTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal?: AbortSignal; cleanup: () => void } {
  if (timeoutMs <= 0) {
    return signal
      ? { signal, cleanup: () => undefined }
      : { cleanup: () => undefined };
  }

  const timeoutSignal =
    typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : undefined;

  if (timeoutSignal && signal && typeof AbortSignal.any === 'function') {
    return {
      signal: AbortSignal.any([signal, timeoutSignal]),
      cleanup: () => undefined,
    };
  }

  const controller = new AbortController();
  let timeout: number | undefined;

  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abort, { once: true });
  }

  if (timeoutSignal) {
    if (timeoutSignal.aborted) controller.abort();
    else timeoutSignal.addEventListener('abort', abort, { once: true });
  } else {
    timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      timeoutSignal?.removeEventListener('abort', abort);
    },
  };
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (
    init.body !== undefined &&
    init.body !== null &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }

  const requestInit: RequestInit = {
    ...init,
    headers,
  };

  const timeout = abortSignalWithTimeout(signal, timeoutMs);
  if (timeout.signal) requestInit.signal = timeout.signal;

  const response = await fetch(`${env.apiBase}${path}`, requestInit).finally(
    timeout.cleanup,
  );

  if (!response.ok) {
    throw await apiErrorFromResponse(response);
  }

  return response.json() as Promise<T>;
}

export const api = {
  search: async (body: SearchRequest, signal?: AbortSignal) =>
    normalizeSearchResponse(
      await request<RawSearchResponse>(
        '/v1/search',
        { method: 'POST', body: JSON.stringify(body) },
        signal,
      ),
    ),

  explain: (
    sourceKey: string,
    query: string,
    kind: string,
    signal?: AbortSignal,
  ) => {
    const encodedKey = encodeURIComponent(sourceKey);
    return request<ExplainResponse>(
      buildUrl(`/v1/explain/${encodedKey}`, { query, kind }),
      {},
      signal,
    );
  },

  suggestFilters: (prefix: string, signal?: AbortSignal) =>
    request<SuggestFiltersResponse>(
      buildUrl('/v1/suggest/filters', { prefix }),
      {},
      signal,
    ),

  graph: (filters: GraphFilters = {}, signal?: AbortSignal) =>
    request<GraphResponse>(
      '/v1/graph',
      { method: 'POST', body: JSON.stringify(filters) },
      signal,
    ),

  healthz: (signal?: AbortSignal) =>
    request<{ status: string }>('/healthz', {}, signal, 3_000),
};
