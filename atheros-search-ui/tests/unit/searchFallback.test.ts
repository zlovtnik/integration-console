import { describe, expect, it } from 'vitest';
import { fallbackBannerCopy, hasSearchFallback } from '~/utils/searchFallback';

describe('search fallback copy', () => {
  it('detects a fallback from either the code or the reason', () => {
    expect(hasSearchFallback({})).toBe(false);
    expect(hasSearchFallback({ fallback_reason: '  ' })).toBe(false);
    expect(hasSearchFallback({ fallback_reason: 'x' })).toBe(true);
    expect(hasSearchFallback({ fallback_code: 'dense_query_failed' })).toBe(
      true,
    );
  });

  it('uses the stable code instead of the raw reason', () => {
    expect(
      fallbackBannerCopy({
        fallback_code: 'embedding_backend_unavailable',
        fallback_reason: 'semantic backend unavailable',
      }),
    ).toBe('Embedding backend unavailable - showing keyword results only.');
  });

  it('keeps a distinct headline per code', () => {
    expect(
      fallbackBannerCopy({ fallback_code: 'embedding_capacity_exhausted' }),
    ).toBe('Semantic search is busy - showing keyword results only.');
    expect(
      fallbackBannerCopy({ fallback_code: 'embedding_invalid_response' }),
    ).toBe(
      'Embedding backend returned an unusable response - showing keyword results only.',
    );
    expect(fallbackBannerCopy({ fallback_code: 'dense_query_failed' })).toBe(
      'Semantic ranking failed - showing keyword results only.',
    );
    expect(fallbackBannerCopy({ fallback_code: 'no_embedding_coverage' })).toBe(
      'This content type is not indexed for semantic search yet - showing keyword matches only.',
    );
  });

  it('falls back to the legacy reason wording when no code is sent', () => {
    expect(
      fallbackBannerCopy({
        fallback_reason:
          'no embeddings indexed for requested kind SEARCH_KIND_DEVICE',
      }),
    ).toBe(
      'This content type is not indexed for semantic search yet - showing keyword matches only. no embeddings indexed for requested kind SEARCH_KIND_DEVICE',
    );
    expect(
      fallbackBannerCopy({ fallback_reason: 'embedding backend unavailable' }),
    ).toBe(
      'Embedding backend unavailable - showing keyword results only. embedding backend unavailable',
    );
    expect(fallbackBannerCopy({ fallback_reason: 'something else' })).toBe(
      'Semantic search unavailable - showing keyword results only. something else',
    );
  });

  it('adds a retry hint only for a retry time in the future', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(
      fallbackBannerCopy({
        fallback_code: 'embedding_backend_unavailable',
        fallback_retry_at: future,
      }),
    ).toMatch(/^Embedding backend unavailable.* Retry expected after /);
    expect(
      fallbackBannerCopy({
        fallback_code: 'embedding_backend_unavailable',
        fallback_retry_at: new Date(Date.now() - 60_000).toISOString(),
      }),
    ).toBe('Embedding backend unavailable - showing keyword results only.');
    expect(
      fallbackBannerCopy({
        fallback_code: 'embedding_backend_unavailable',
        fallback_retry_at: 'not-a-date',
      }),
    ).toBe('Embedding backend unavailable - showing keyword results only.');
  });
});
