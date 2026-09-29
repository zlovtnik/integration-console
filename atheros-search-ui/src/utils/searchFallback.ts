import { SEARCH_FALLBACK_CODES } from '~/api/types';
import type { SearchFallbackCode } from '~/api/types';
import { formatDateTime } from '~/utils/formatDateTime';

export interface SearchFallback {
  fallback_reason?: string;
  fallback_code?: string;
  fallback_retry_at?: string;
}

/** True when the response carries a degradation worth telling the user about. */
export function hasSearchFallback(meta: SearchFallback): boolean {
  return Boolean(
    (meta.fallback_code && meta.fallback_code.trim().length > 0) ||
    (meta.fallback_reason && meta.fallback_reason.trim().length > 0),
  );
}

function fallbackHeadline(code: string, reason: string): string {
  switch (code) {
    case 'no_embedding_coverage':
      return 'This content type is not indexed for semantic search yet - showing keyword matches only.';
    case 'embedding_capacity_exhausted':
      return 'Semantic search is busy - showing keyword results only.';
    case 'embedding_invalid_response':
      return 'Embedding backend returned an unusable response - showing keyword results only.';
    case 'dense_query_failed':
      return 'Semantic ranking failed - showing keyword results only.';
    case 'embedding_backend_unavailable':
      return 'Embedding backend unavailable - showing keyword results only.';
  }
  // Older servers only send fallback_reason, so keep recognising their
  // wording until the code field is everywhere.
  if (reason.startsWith('no embeddings indexed for requested kind')) {
    return 'This content type is not indexed for semantic search yet - showing keyword matches only.';
  }
  if (reason.startsWith('embedding backend')) {
    return 'Embedding backend unavailable - showing keyword results only.';
  }
  return 'Semantic search unavailable - showing keyword results only.';
}

function fallbackRetryHint(retryAt: string | undefined): string {
  if (!retryAt) return '';
  const parsed = Date.parse(retryAt);
  if (Number.isNaN(parsed) || parsed <= Date.now()) return '';
  return ` Retry expected after ${formatDateTime(retryAt)}.`;
}

export function fallbackBannerCopy(meta: SearchFallback): string {
  const detail = (meta.fallback_reason ?? '').trim();
  const code = (meta.fallback_code ?? '').trim();
  const headline = fallbackHeadline(code, detail);
  // A recognised code already explains the situation; the server-supplied
  // reason would only repeat it. Older servers send no code, so keep the
  // detail there.
  const body = SEARCH_FALLBACK_CODES.includes(code as SearchFallbackCode)
    ? ''
    : detail
      ? ` ${detail}`
      : '';
  return `${headline}${body}${fallbackRetryHint(meta.fallback_retry_at)}`;
}
