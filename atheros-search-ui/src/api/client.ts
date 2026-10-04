import { env } from '~/env';
import { denyAuditAccess, getAccessToken } from '~/auth/session';
import { auditGeneration, auditSignal } from '~/auth/auditState';
import { isRfc3339 } from '~/utils/timestamp';
import type {
  ActivityBucket,
  Communication,
  EmbeddingWork,
  ETLHealth,
  ExplainResponse,
  GraphFilters,
  GraphResponse,
  InventoryEdge,
  InventoryFilters,
  InventoryNode,
  InventoryNodeKind,
  InventoryResponse,
  InvestigationFreshness,
  MergeDecision,
  MergeDecisionResponse,
  Neighbour,
  RecordContextResponse,
  RecordFields,
  SearchRequest,
  SearchResponse,
  SearchResult,
  SearchFilters,
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
const responseGenerations = new WeakMap<Response, number>();

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
  proxyEventType?: unknown;
  proxyDeviceId?: unknown;
  windowStart?: unknown;
  windowEnd?: unknown;
};

type RawSearchResponse = Omit<Partial<SearchResponse>, 'results'> & {
  generatedAt?: unknown;
  queryId?: unknown;
  modeUsed?: unknown;
  fallbackReason?: unknown;
  fallbackCode?: unknown;
  fallbackRetryAt?: unknown;
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
  totalDeviceCount?: unknown;
  totalNodeCount?: unknown;
  totalEdgeCount?: unknown;
  nextPageCursor?: unknown;
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

function optionalBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
  }
  return undefined;
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
  const host = firstString(raw.host);
  if (host) result.host = host;
  const blocked = optionalBoolean(raw.blocked);
  if (blocked !== undefined) result.blocked = blocked;
  const proxyEventType = firstString(raw.proxy_event_type, raw.proxyEventType);
  if (proxyEventType) result.proxy_event_type = proxyEventType;
  const proxyDeviceId = firstString(raw.proxy_device_id, raw.proxyDeviceId);
  if (proxyDeviceId) result.proxy_device_id = proxyDeviceId;
  const windowStart = firstString(raw.window_start, raw.windowStart);
  if (windowStart) result.window_start = windowStart;
  const windowEnd = firstString(raw.window_end, raw.windowEnd);
  if (windowEnd) result.window_end = windowEnd;
  const classification = firstString(raw.classification);
  if (classification) result.classification = classification;
  return result;
}

export function normalizeSearchMeta(
  raw: RawSearchResponse,
): Partial<SearchResponse> {
  const meta: Partial<SearchResponse> = {};
  if (raw.report) meta.report = raw.report as import('./types').ReportMetadata;
  const generated = firstString(raw.generated_at, raw.generatedAt);
  if (generated) meta.generated_at = generated;
  const modeUsed = firstString(raw.mode_used, raw.modeUsed);
  const fallbackReason = firstString(raw.fallback_reason, raw.fallbackReason);
  const fallbackCode = firstString(raw.fallback_code, raw.fallbackCode);
  const fallbackRetryAt = firstString(
    raw.fallback_retry_at,
    raw.fallbackRetryAt,
  );
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
  if (fallbackCode) meta.fallback_code = fallbackCode;
  if (fallbackRetryAt) meta.fallback_retry_at = fallbackRetryAt;
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
    ...meta,
    query_id: meta.query_id ?? 0,
    results: rawResults.map((result) =>
      normalizeSearchResult(result as RawSearchResult),
    ),
    mode_used: meta.mode_used ?? 'SEARCH_MODE_UNSPECIFIED',
    fallback_reason: meta.fallback_reason ?? '',
    fallback_code: meta.fallback_code ?? '',
    dense_result_count: meta.dense_result_count ?? 0,
    sparse_result_count: meta.sparse_result_count ?? 0,
    fused_result_count: meta.fused_result_count ?? 0,
  };
}

type RawExplainResponse = Record<string, unknown>;

export function normalizeExplainResponse(
  raw: RawExplainResponse,
): ExplainResponse {
  const normalized: ExplainResponse = {
    source_key: firstString(raw.source_key, raw.sourceKey),
    dense_score: firstNumber(raw.dense_score, raw.denseScore),
    sparse_score: firstNumber(raw.sparse_score, raw.sparseScore),
    fused_score: firstNumber(raw.fused_score, raw.fusedScore),
    threat_boost: firstNumber(raw.threat_boost, raw.threatBoost),
    boost_reasons: stringArray(raw.boost_reasons ?? raw.boostReasons),
    sequence_log_prob: firstNumber(raw.sequence_log_prob, raw.sequenceLogProb),
  };
  const sequenceTokens = stringArray(
    raw.sequence_tokens ?? raw.sequenceTokens ?? [],
  );
  if (sequenceTokens.length > 0) normalized.sequence_tokens = sequenceTokens;
  const detail = detailJson(raw.detail_json, raw.detailJson);
  if (detail) normalized.detail_json = detail;
  const found = optionalBoolean(raw.found);
  if (found !== undefined) normalized.found = found;
  const scoresAvailable = optionalBoolean(
    raw.scores_available,
    raw.scoresAvailable,
  );
  if (scoresAvailable !== undefined) {
    normalized.scores_available = scoresAvailable;
  } else {
    normalized.scores_available = found === undefined || found;
  }
  const sourceKind = firstString(raw.source_kind, raw.sourceKind);
  const method = firstString(raw.ranking_method, raw.rankingMethod);
  if (method) normalized.ranking_method = method;
  if (sourceKind) normalized.source_kind = sourceKind;
  const record = raw.record;
  if (typeof record === 'object' && record !== null && !Array.isArray(record)) {
    normalized.record = normalizeRecordFields(record as RawRecord);
  }
  return normalized;
}

type RawRecord = Record<string, unknown>;

function normalizeRecordFields(raw: RawRecord): RecordFields {
  return {
    document_id: firstString(raw.document_id, raw.documentId),
    source_key: firstString(raw.source_key, raw.sourceKey),
    source_table: firstString(raw.source_table, raw.sourceTable),
    source_kind: firstString(raw.source_kind, raw.sourceKind),
    status: firstString(raw.status),
    source_mac: firstString(raw.source_mac, raw.sourceMac),
    bssid: firstString(raw.bssid),
    ssid: firstString(raw.ssid),
    location_id: firstString(raw.location_id, raw.locationId),
    sensor_id: firstString(raw.sensor_id, raw.sensorId),
    frame_subtype: firstString(raw.frame_subtype, raw.frameSubtype),
    classification: firstString(raw.classification),
    title: firstString(raw.title),
    producer: firstString(raw.producer),
    tags: stringArray(raw.tags),
    security_flags: firstNumber(raw.security_flags, raw.securityFlags),
    handshake_captured: firstBoolean(
      false,
      raw.handshake_captured,
      raw.handshakeCaptured,
    ),
    host: firstString(raw.host),
    blocked: optionalBoolean(raw.blocked) ?? null,
    proxy_event_type: firstString(raw.proxy_event_type, raw.proxyEventType),
    proxy_device_id: firstString(raw.proxy_device_id, raw.proxyDeviceId),
    observed_at: firstString(raw.observed_at, raw.observedAt) || undefined,
    window_start: firstString(raw.window_start, raw.windowStart) || undefined,
    window_end: firstString(raw.window_end, raw.windowEnd) || undefined,
    normalized_sha256: firstString(raw.normalized_sha256, raw.normalizedSha256),
    detail_json: detailJson(raw.detail_json, raw.detailJson),
    sequence_tokens: stringArray(
      raw.sequence_tokens ?? raw.sequenceTokens,
    ) as string[],
  };
}

function normalizeActivityBucket(raw: RawRecord): ActivityBucket {
  return {
    window_start: firstString(raw.window_start, raw.windowStart),
    frame_count: firstNumber(raw.frame_count, raw.frameCount),
    frames_per_minute: firstNumber(raw.frames_per_minute, raw.framesPerMinute),
    sensor_count: firstNumber(raw.sensor_count, raw.sensorCount),
    ap_count: firstNumber(raw.ap_count, raw.apCount),
    rssi_avg_dbm: optionalNumber(raw.rssi_avg_dbm, raw.rssiAvgDbm),
    first_observed_at: firstString(raw.first_observed_at, raw.firstObservedAt),
    last_observed_at: firstString(raw.last_observed_at, raw.lastObservedAt),
  };
}

function normalizeCommunication(raw: RawRecord): Communication {
  const weight = optionalNumber(raw.weight);
  const basis = firstString(raw.weight_basis, raw.weightBasis);
  return {
    type: firstString(raw.type),
    from: firstString(raw.from),
    to: firstString(raw.to),
    weight,
    weight_basis: basis || undefined,
    confidence: firstString(raw.confidence) || undefined,
    fresh: firstBoolean(false, raw.fresh),
    evidence_references: stringArray(
      raw.evidence_references ?? raw.evidenceReferences,
    ),
  };
}

function normalizeNeighbour(raw: RawRecord): Neighbour {
  return {
    mac: firstString(raw.mac),
    label: firstString(raw.label),
    ap_count: firstNumber(raw.ap_count, raw.apCount),
    window_count: firstNumber(raw.window_count, raw.windowCount),
    sensor_count: firstNumber(raw.sensor_count, raw.sensorCount),
    frame_count: firstNumber(raw.frame_count, raw.frameCount),
    rssi_avg_dbm: optionalNumber(raw.rssi_avg_dbm, raw.rssiAvgDbm),
    first_observed_at: firstString(raw.first_observed_at, raw.firstObservedAt),
    last_observed_at: firstString(raw.last_observed_at, raw.lastObservedAt),
    corroborated: firstBoolean(false, raw.corroborated),
  };
}

function normalizeEmbeddingWork(raw: RawRecord): EmbeddingWork {
  return {
    embedding_kind: firstString(raw.embedding_kind, raw.embeddingKind),
    embedding_model: firstString(raw.embedding_model, raw.embeddingModel),
    status: firstString(raw.status),
    attempt_count: firstNumber(raw.attempt_count, raw.attemptCount),
    max_attempts: firstNumber(raw.max_attempts, raw.maxAttempts),
    next_attempt_at: firstString(raw.next_attempt_at, raw.nextAttemptAt),
    last_error: firstString(raw.last_error, raw.lastError) || undefined,
    completed_at: firstString(raw.completed_at, raw.completedAt),
    embedded_at: firstString(raw.embedded_at, raw.embeddedAt),
    content_sha256: firstString(raw.content_sha256, raw.contentSha256),
    has_vector: firstBoolean(false, raw.has_vector, raw.hasVector),
    content_current: firstBoolean(
      false,
      raw.content_current,
      raw.contentCurrent,
    ),
  };
}

function normalizeFreshness(raw: unknown): InvestigationFreshness | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const value = raw as RawRecord;
  const status = firstString(value.coverage_status, value.coverageStatus);
  return {
    source_watermark: firstString(
      value.source_watermark,
      value.sourceWatermark,
    ),
    projection_watermark: firstString(
      value.projection_watermark,
      value.projectionWatermark,
    ),
    coverage_status: (
      ['complete', 'partial', 'stalled', 'unknown'] as const
    ).includes(status as 'complete')
      ? (status as InvestigationFreshness['coverage_status'])
      : 'unknown',
    coverage_reason: firstString(value.coverage_reason, value.coverageReason),
  };
}

export function normalizeRecordContext(
  raw: Record<string, unknown>,
): RecordContextResponse {
  const record = raw.record;
  const related = raw.related;
  const activity = Array.isArray(raw.activity) ? raw.activity : [];
  const embedding = Array.isArray(raw.embedding) ? raw.embedding : [];
  const totals = (raw.activity_totals ?? raw.activityTotals) as
    | RawRecord
    | undefined;
  const normalized: RecordContextResponse = {
    source_key: firstString(raw.source_key, raw.sourceKey),
    found: firstBoolean(false, raw.found),
    window_start: firstString(raw.window_start, raw.windowStart),
    window_end: firstString(raw.window_end, raw.windowEnd),
    bucket_minutes: firstNumber(raw.bucket_minutes, raw.bucketMinutes),
    activity: activity.map((item) =>
      normalizeActivityBucket(item as RawRecord),
    ),
    activity_totals: {
      buckets: firstNumber(totals?.buckets),
      frame_count: firstNumber(totals?.frame_count, totals?.frameCount),
      frames_per_minute: firstNumber(
        totals?.frames_per_minute,
        totals?.framesPerMinute,
      ),
      peak_frames_per_minute: firstNumber(
        totals?.peak_frames_per_minute,
        totals?.peakFramesPerMinute,
      ),
      peak_window: firstString(totals?.peak_window, totals?.peakWindow),
      sensor_count: firstNumber(totals?.sensor_count, totals?.sensorCount),
      ap_count: firstNumber(totals?.ap_count, totals?.apCount),
      first_observed_at: firstString(
        totals?.first_observed_at,
        totals?.firstObservedAt,
      ),
      last_observed_at: firstString(
        totals?.last_observed_at,
        totals?.lastObservedAt,
      ),
    },
    // `related` is null when the record has no MAC or BSSID to anchor on. That
    // is distinct from an anchor with no neighbours, which is an empty array.
    related:
      typeof related === 'object' && related !== null && !Array.isArray(related)
        ? {
            anchor_kind: firstString(
              (related as RawRecord).anchor_kind,
              (related as RawRecord).anchorKind,
            ),
            anchor_id: firstString(
              (related as RawRecord).anchor_id,
              (related as RawRecord).anchorId,
            ),
            neighbours: (
              ((related as RawRecord).neighbours as unknown[]) ?? []
            ).map((item) => normalizeNeighbour(item as RawRecord)),
            links: (((related as RawRecord).links as unknown[]) ?? []).map(
              (item) => normalizeCommunication(item as RawRecord),
            ),
            rf_proximity: firstString(
              (related as RawRecord).rf_proximity,
              (related as RawRecord).rfProximity,
            ),
            signal_quality: firstString(
              (related as RawRecord).signal_quality,
              (related as RawRecord).signalQuality,
            ),
            confidence: firstString((related as RawRecord).confidence),
            focus_reason: firstString(
              (related as RawRecord).focus_reason,
              (related as RawRecord).focusReason,
            ),
          }
        : null,
    embedding: embedding.map((item) =>
      normalizeEmbeddingWork(item as RawRecord),
    ),
    generated_at: firstString(raw.generated_at, raw.generatedAt),
  };
  const recordFields =
    typeof record === 'object' && record !== null && !Array.isArray(record)
      ? normalizeRecordFields(record as RawRecord)
      : undefined;
  if (recordFields) normalized.record = recordFields;
  const reason = firstString(
    raw.related_unavailable_reason,
    raw.relatedUnavailableReason,
  );
  if (reason) normalized.related_unavailable_reason = reason;
  const note = firstString(raw.embedding_note, raw.embeddingNote);
  if (note) normalized.embedding_note = note;
  const freshness = normalizeFreshness(raw.freshness);
  if (freshness) normalized.freshness = freshness;
  return normalized;
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
  const registered = optionalBoolean(raw.registered);
  if (registered !== undefined) node.registered = registered;
  const noAPLink = optionalBoolean(raw.no_ap_link_in_projection);
  if (noAPLink !== undefined) node.no_ap_link_in_projection = noAPLink;
  const pending = optionalNumber(raw.pending_review_count);
  if (pending !== undefined) node.pending_review_count = pending;
  const firstSeen = firstString(raw.first_seen);
  if (firstSeen) node.first_seen = firstSeen;
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

  const response: InventoryResponse = {
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
  };
  const registeredCount = optionalNumber(
    raw.total_registered_count,
    raw.totalRegisteredCount,
  );
  if (registeredCount !== undefined)
    response.total_registered_count = registeredCount;
  if (raw.report)
    response.report = raw.report as import('./types').ReportMetadata;
  const nextPageCursor = firstString(raw.next_page_cursor, raw.nextPageCursor);
  if (nextPageCursor) response.next_page_cursor = nextPageCursor;
  const totalNodeCount = optionalNumber(
    raw.total_node_count,
    raw.totalNodeCount,
  );
  if (totalNodeCount !== undefined) response.total_node_count = totalNodeCount;
  const totalEdgeCount = optionalNumber(
    raw.total_edge_count,
    raw.totalEdgeCount,
  );
  if (totalEdgeCount !== undefined) response.total_edge_count = totalEdgeCount;
  const totalDeviceCount = optionalNumber(
    raw.total_device_count,
    raw.totalDeviceCount,
  );
  if (totalDeviceCount !== undefined) {
    response.total_device_count = totalDeviceCount;
  }
  return response;
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

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = await getAccessToken();
  const generation = auditGeneration();
  const sessionSignal = auditSignal();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const requestInit = {
    ...init,
    headers,
    signal: init.signal
      ? AbortSignal.any([init.signal, sessionSignal])
      : sessionSignal,
  };
  let response = await fetch(input, requestInit);

  if (response.status === 401) {
    const refreshedToken = await getAccessToken(true);
    if (refreshedToken) {
      headers.set('Authorization', `Bearer ${refreshedToken}`);
      response = await fetch(input, requestInit);
    }
  }

  if (generation !== auditGeneration())
    throw new DOMException('Identity changed', 'AbortError');
  if (response.status === 401 || response.status === 403) denyAuditAccess();
  responseGenerations.set(response, generation);
  return response;
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

  let response: Response;
  try {
    response =
      path.startsWith('/v1/') && path !== '/v1/healthz'
        ? await authenticatedFetch(`${env.apiBase}${path}`, requestInit)
        : await fetch(`${env.apiBase}${path}`, requestInit);
  } finally {
    timeout.cleanup();
  }

  if (!response.ok) {
    throw await apiErrorFromResponse(response);
  }

  const generation = responseGenerations.get(response) ?? auditGeneration();
  const data = (await response.json()) as T;
  if (generation !== auditGeneration())
    throw new DOMException('Identity changed', 'AbortError');
  return data;
}

export const api = {
  etlHealth: (signal?: AbortSignal) =>
    request<ETLHealth>('/v1/etl/health', {}, signal, 3000),
  network: (filters: import('./types').NetworkFilters, signal?: AbortSignal) =>
    request<import('./types').NetworkResponse>(
      '/v1/network-map',
      { method: 'POST', body: JSON.stringify(filters) },
      signal,
    ),
  entities: (
    kind: 'ap' | 'device',
    q = '',
    pageCursor?: string,
    signal?: AbortSignal,
  ) =>
    request<import('./types').EntitiesResponse>(
      buildUrl('/v1/entities', {
        kind,
        q,
        page_cursor: pageCursor,
        page_size: '12',
      }),
      {},
      signal,
    ),
  investigation: (
    body: import('./types').InvestigationRequest,
    signal?: AbortSignal,
  ) =>
    request<import('./types').InvestigationResponse>(
      '/v1/investigation',
      { method: 'POST', body: JSON.stringify(body) },
      signal,
    ),
  evidence: (
    body: import('./types').InvestigationRequest,
    signal?: AbortSignal,
  ) =>
    request<import('./types').InvestigationResponse>(
      '/v1/evidence',
      { method: 'POST', body: JSON.stringify(body) },
      signal,
    ),
  assetAnnotation: (kind: 'ap' | 'device', id: string, signal?: AbortSignal) =>
    request<import('./types').AssetAnnotation>(
      `/v1/asset-annotations/${kind}/${encodeURIComponent(id)}`,
      {},
      signal,
    ),
  updateAssetAnnotation: (
    kind: 'ap' | 'device',
    id: string,
    body: import('./types').AssetAnnotationUpdate,
    signal?: AbortSignal,
  ) =>
    request<import('./types').AssetAnnotation>(
      `/v1/asset-annotations/${kind}/${encodeURIComponent(id)}`,
      { method: 'PUT', body: JSON.stringify(body) },
      signal,
    ),
  pairDetail: (candidateId: string, signal?: AbortSignal) =>
    request<import('./types').PairDetail>(
      `/v1/inventory/merge-candidates/${encodeURIComponent(candidateId)}`,
      {},
      signal,
    ),
  search: async (body: SearchRequest, signal?: AbortSignal) =>
    normalizeSearchResponse(
      await request<RawSearchResponse>(
        '/v1/search',
        { method: 'POST', body: JSON.stringify(prepareSearchRequest(body)) },
        signal,
      ),
    ),

  explain: async (
    sourceKey: string,
    query: string,
    kind: string,
    signal?: AbortSignal,
  ) => {
    const encodedKey = encodeURIComponent(sourceKey);
    return normalizeExplainResponse(
      await request<RawExplainResponse>(
        buildUrl(`/v1/explain/${encodedKey}`, { query, kind }),
        {},
        signal,
      ),
    );
  },

  explainScoped: async (
    body: {
      source_key: string;
      query: string;
      kind: string;
      filters?: SearchFilters;
    },
    signal?: AbortSignal,
  ) =>
    normalizeExplainResponse(
      await request<RawExplainResponse>(
        '/v1/explain/scoped',
        { method: 'POST', body: JSON.stringify(body) },
        signal,
      ),
    ),

  recordContext: async (
    sourceKey: string,
    params: { kind?: string; window?: string; bucket_minutes?: number } = {},
    signal?: AbortSignal,
  ) =>
    normalizeRecordContext(
      await request<Record<string, unknown>>(
        buildUrl(`/v1/records/${encodeURIComponent(sourceKey)}/context`, {
          kind: params.kind,
          window: params.window,
          bucket_minutes:
            params.bucket_minutes === undefined
              ? undefined
              : String(params.bucket_minutes),
        }),
        {},
        signal,
      ),
    ),

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

  graphPage: (
    filters: GraphFilters,
    pageCursor: string | undefined,
    signal?: AbortSignal,
  ) => {
    const body: GraphFilters = { ...filters };
    delete body.limit;
    delete body.page_cursor;
    if (pageCursor) body.page_cursor = pageCursor;
    return request<GraphResponse>(
      '/v1/graph',
      { method: 'POST', body: JSON.stringify(prepareGraphFilters(body)) },
      signal,
    );
  },

  inventory: async (filters: InventoryFilters, signal?: AbortSignal) =>
    normalizeInventoryResponse(
      await request<RawInventoryResponse>(
        '/v1/inventory',
        { method: 'POST', body: JSON.stringify(filters) },
        signal,
      ),
    ),

  inventoryPage: async (
    filters: InventoryFilters,
    pageCursor: string | undefined,
    signal?: AbortSignal,
  ) => {
    const body: InventoryFilters = { ...filters };
    delete body.limit;
    delete body.page_cursor;
    if (pageCursor) body.page_cursor = pageCursor;
    return normalizeInventoryResponse(
      await request<RawInventoryResponse>(
        '/v1/inventory',
        { method: 'POST', body: JSON.stringify(body) },
        signal,
      ),
    );
  },

  mergeDecision: (
    candidateId: string,
    decision: MergeDecision,
    signal?: AbortSignal,
  ) =>
    request<MergeDecisionResponse>(
      `/v1/inventory/merge-candidates/${encodeURIComponent(candidateId)}/decision`,
      { method: 'POST', body: JSON.stringify({ decision }) },
      signal,
    ),

  healthz: (signal?: AbortSignal) =>
    request<{ status: string }>('/v1/healthz', {}, signal, 3_000),
};
