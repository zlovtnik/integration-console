import { env } from '~/env';
import { isRfc3339 } from '~/utils/timestamp';
import type {
  ExplainResponse,
  GraphFilters,
  GraphResponse,
  InventoryEdge,
  InventoryFilters,
  InventoryNode,
  InventoryNodeKind,
  InventoryResponse,
  MergeDecision,
  MergeDecisionResponse,
  SearchRequest,
  SearchResponse,
  SearchResult,
  SuggestFiltersResponse,
} from './types';

const DEFAULT_TIMEOUT_MS = 30_000;
const TIMESTAMP_FIELD_NAMES = ['observed_after', 'observed_before'] as const;

type TimestampFieldName = (typeof TIMESTAMP_FIELD_NAMES)[number];
type TimestampCarrier = Partial<Record<TimestampFieldName, unknown>>;

export type OutgoingTimestampIssue = {
  path: string;
  value: unknown;
};

export type OutgoingTimestampReporter = (
  context: string,
  issues: readonly OutgoingTimestampIssue[],
) => void;

type ApiErrorPayload = {
  code?: string;
  message?: string;
};

let outgoingTimestampReporter: OutgoingTimestampReporter | undefined;

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

type RawInventoryNode = Partial<InventoryNode> & {
  knownMacs?: unknown;
  displayName?: unknown;
  ownerId?: unknown;
  locationId?: unknown;
  firstRegistered?: unknown;
  lastSeen?: unknown;
  similarityClusterId?: unknown;
  dedupConfidence?: unknown;
};

type RawInventoryEdge = Partial<InventoryEdge> & {
  sourceId?: unknown;
  targetId?: unknown;
};

type RawInventoryResponse = Omit<
  Partial<InventoryResponse>,
  'nodes' | 'edges'
> & {
  generatedAt?: unknown;
  nodeCount?: unknown;
  edgeCount?: unknown;
  totalRegisteredCount?: unknown;
  nodes?: unknown;
  edges?: unknown;
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

export function setOutgoingTimestampReporter(
  reporter: OutgoingTimestampReporter | undefined,
) {
  outgoingTimestampReporter = reporter;
}

function sanitizeTimestampCarrier<T extends TimestampCarrier>(
  source: T | undefined,
  basePath: string,
): { value: T | undefined; issues: OutgoingTimestampIssue[] } {
  if (!source) return { value: source, issues: [] };

  let next: T | undefined;
  const issues: OutgoingTimestampIssue[] = [];

  for (const field of TIMESTAMP_FIELD_NAMES) {
    if (!(field in source)) continue;
    const value = source[field];
    if (typeof value === 'string' && isRfc3339(value)) {
      continue;
    }

    issues.push({ path: `${basePath}.${field}`, value });
    next = next ?? { ...source };
    delete next[field];
  }

  return { value: next ?? source, issues };
}

function reportOutgoingTimestampIssues(
  context: string,
  issues: readonly OutgoingTimestampIssue[],
) {
  if (issues.length === 0) return;

  outgoingTimestampReporter?.(context, issues);
  if (import.meta.env.DEV) {
    console.error('Invalid outgoing RFC 3339 timestamp fields were dropped.', {
      context,
      issues,
    });
  }
}

export function prepareSearchRequest(
  body: SearchRequest,
  context = 'search',
): SearchRequest {
  const sanitized = sanitizeTimestampCarrier(body.filters, 'filters');
  if (sanitized.issues.length === 0) return body;

  reportOutgoingTimestampIssues(context, sanitized.issues);
  const next: SearchRequest = { ...body };
  if (sanitized.value && Object.keys(sanitized.value).length > 0) {
    next.filters = sanitized.value;
  } else {
    delete next.filters;
  }
  return next;
}

export function prepareGraphFilters(
  filters: GraphFilters = {},
  context = 'graph',
): GraphFilters {
  const sanitized = sanitizeTimestampCarrier(filters, 'filters');
  if (sanitized.issues.length === 0) return filters;

  reportOutgoingTimestampIssues(context, sanitized.issues);
  return sanitized.value ?? {};
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

function optionalNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function firstBoolean(defaultValue: boolean, ...values: unknown[]): boolean {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
  }
  return defaultValue;
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

const INVENTORY_NODE_KINDS: InventoryNodeKind[] = [
  'device',
  'owner',
  'location_asset',
  'cluster',
  'merge_candidate',
];

function inventoryNodeKind(value: unknown): InventoryNodeKind {
  return typeof value === 'string' &&
    INVENTORY_NODE_KINDS.includes(value as InventoryNodeKind)
    ? (value as InventoryNodeKind)
    : 'device';
}

function normalizeInventoryNode(raw: RawInventoryNode): InventoryNode {
  const node: InventoryNode = {
    id: firstString(raw.id),
    kind: inventoryNodeKind(raw.kind),
    label: firstString(raw.label, raw.display_name, raw.displayName, raw.mac),
    active: firstBoolean(false, raw.active),
  };
  const mac = firstString(raw.mac);
  const displayName = firstString(raw.display_name, raw.displayName);
  const ownerId = firstString(raw.owner_id, raw.ownerId);
  const locationId = firstString(raw.location_id, raw.locationId);
  const firstRegistered = firstString(
    raw.first_registered,
    raw.firstRegistered,
  );
  const lastSeen = firstString(raw.last_seen, raw.lastSeen);
  const similarityClusterId = firstString(
    raw.similarity_cluster_id,
    raw.similarityClusterId,
  );
  const confidence = optionalNumber(raw.dedup_confidence, raw.dedupConfidence);
  const knownMacs = stringArray(raw.known_macs ?? raw.knownMacs);
  const tags = stringArray(raw.tags);

  if (mac) node.mac = mac;
  if (knownMacs.length > 0) node.known_macs = knownMacs;
  if (displayName) node.display_name = displayName;
  if (ownerId) node.owner_id = ownerId;
  if (locationId) node.location_id = locationId;
  if (firstRegistered) node.first_registered = firstRegistered;
  if (lastSeen) node.last_seen = lastSeen;
  if (similarityClusterId) node.similarity_cluster_id = similarityClusterId;
  if (confidence !== undefined) node.dedup_confidence = confidence;
  if (tags.length > 0) node.tags = tags;

  return node;
}

function normalizeInventoryEdge(raw: RawInventoryEdge): InventoryEdge {
  const edge: InventoryEdge = {
    id: firstString(raw.id),
    source: firstString(raw.source, raw.sourceId),
    target: firstString(raw.target, raw.targetId),
    kind: firstString(raw.kind) as InventoryEdge['kind'],
  };
  const weight = optionalNumber(raw.weight);
  if (weight !== undefined) edge.weight = weight;
  return edge;
}

export function normalizeInventoryResponse(
  raw: RawInventoryResponse,
): InventoryResponse {
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const edges = Array.isArray(raw.edges) ? raw.edges : [];
  const normalizedNodes = nodes.map((node) =>
    normalizeInventoryNode(node as RawInventoryNode),
  );
  const normalizedEdges = edges.map((edge) =>
    normalizeInventoryEdge(edge as RawInventoryEdge),
  );

  return {
    nodes: normalizedNodes,
    edges: normalizedEdges,
    generated_at: firstString(raw.generated_at, raw.generatedAt),
    node_count: firstNumber(
      raw.node_count,
      raw.nodeCount,
      normalizedNodes.length,
    ),
    edge_count: firstNumber(
      raw.edge_count,
      raw.edgeCount,
      normalizedEdges.length,
    ),
    total_registered_count: firstNumber(
      raw.total_registered_count,
      raw.totalRegisteredCount,
      normalizedNodes.filter((node) => node.kind === 'device').length,
    ),
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
        { method: 'POST', body: JSON.stringify(prepareSearchRequest(body)) },
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
      { method: 'POST', body: JSON.stringify(prepareGraphFilters(filters)) },
      signal,
    ),

  inventory: async (filters: InventoryFilters, signal?: AbortSignal) =>
    normalizeInventoryResponse(
      await request<RawInventoryResponse>(
        '/v1/inventory',
        { method: 'POST', body: JSON.stringify(filters) },
        signal,
      ),
    ),

  mergeDecision: (
    candidateId: string,
    decision: MergeDecision | 'undo_merge',
    signal?: AbortSignal,
  ) =>
    request<MergeDecisionResponse>(
      `/v1/inventory/merge-candidates/${encodeURIComponent(candidateId)}/decision`,
      { method: 'POST', body: JSON.stringify({ decision }) },
      signal,
    ),

  healthz: (signal?: AbortSignal) =>
    request<{ status: string }>('/healthz', {}, signal, 3_000),
};
