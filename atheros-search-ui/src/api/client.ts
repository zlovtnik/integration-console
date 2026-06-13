import { env } from '~/env';
import type {
  ExplainResponse,
  GraphFilters,
  GraphResponse,
  SearchRequest,
  SearchResponse,
  SuggestFiltersResponse,
} from './types';

const DEFAULT_TIMEOUT_MS = 30_000;

type ApiErrorPayload = {
  code?: string;
  message?: string;
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
    return result;
  } catch {
    return undefined;
  }
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
    const rawBody = await response.text().catch(() => '');
    const parsed = parseApiErrorBody(rawBody);
    throw new ApiError(
      response.status,
      parsed?.message || rawBody || response.statusText,
      parsed?.code,
      parsed,
      rawBody,
    );
  }

  return response.json() as Promise<T>;
}

export const api = {
  search: (body: SearchRequest, signal?: AbortSignal) =>
    request<SearchResponse>(
      '/v1/search',
      { method: 'POST', body: JSON.stringify(body) },
      signal,
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
