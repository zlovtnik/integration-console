import { env } from '~/env';
import type {
  ExplainResponse,
  SearchRequest,
  SearchResponse,
  SuggestFiltersResponse,
} from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
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

  if (signal) requestInit.signal = signal;

  const response = await fetch(`${env.apiBase}${path}`, requestInit);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ApiError(response.status, body || response.statusText);
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
    const encodedQuery = encodeURIComponent(query);
    const encodedKind = encodeURIComponent(kind);
    return request<ExplainResponse>(
      `/v1/explain/${encodedKey}?query=${encodedQuery}&kind=${encodedKind}`,
      {},
      signal,
    );
  },

  suggestFilters: (prefix: string, signal?: AbortSignal) =>
    request<SuggestFiltersResponse>(
      `/v1/suggest/filters?prefix=${encodeURIComponent(prefix)}`,
      {},
      signal,
    ),

  healthz: (signal?: AbortSignal) =>
    request<{ status: string }>('/healthz', {}, signal),
};
