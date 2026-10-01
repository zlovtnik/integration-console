import { describe, expect, it } from 'vitest';
import searchFixture from '../../../atheros-search/testdata/contracts/search.json';
import errorsFixture from '../../../atheros-search/testdata/contracts/errors.json';
import { apiErrorFromResponse, normalizeSearchResponse } from '~/api/client';

describe('shared Search contracts', () => {
  it('consumes producer JSON, nullable fields, UTC timestamps, fallback and report metadata', () => {
    expect(searchFixture.report.freshness).toBe('unavailable');
    const response = normalizeSearchResponse({ ...searchFixture, report: { ...searchFixture.report, freshness: 'unavailable' } });
    const first = response.results[0];
    const nullable = response.results[1];
    expect(first).toBeDefined();
    expect(nullable).toBeDefined();
    expect(first?.source_key).toBe('synthetic-record');
    expect(first?.observed_at).toBe('2026-09-01T11:00:00Z');
    expect(first?.blocked).toBe(false);
    expect(nullable?.blocked).toBeUndefined();
    expect(nullable?.observed_at).toBeUndefined();
    expect(response.fallback_code).toBe('embedding_capacity_exhausted');
    expect(response.fallback_retry_at).toBe('2026-09-01T11:01:00Z');
    expect(response.report).toEqual(searchFixture.report);
    expect(response.report?.source_watermark).toBeUndefined();
    expect(response.report?.incomplete_coverage).toBe(true);
  });

  it.each(errorsFixture)('consumes $status error responses', async ({ status, body }) => {
    const error = await apiErrorFromResponse(new Response(JSON.stringify(body), { status }));
    expect(error.status).toBe(status);
    expect(error.message).toBe(body.error);
    expect(error.code).toBe('code' in body ? body.code : undefined);
  });
});
