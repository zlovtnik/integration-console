import { describe, expect, it } from 'vitest';
import { apiErrorFromResponse, normalizeSearchResponse } from '~/api/client';

describe('api client normalization', () => {
  it('normalizes lowerCamelCase ProtoJSON search responses', () => {
    const response = normalizeSearchResponse({
      queryId: 42,
      modeUsed: 'SEARCH_MODE_SPARSE',
      fallbackReason: '',
      denseResultCount: 0,
      sparseResultCount: 1,
      fusedResultCount: 1,
      results: [
        {
          sourceKey: 'event:lab:001',
          sourceTable: 'wireless_frames',
          sourceMac: 'aa:bb:cc:dd:ee:ff',
          locationId: 'lab',
          sensorId: 'sensor-a',
          observedAt: '2026-06-02T12:00:00Z',
          score: 0.4,
          cosineSimilarity: 0,
          keywordRank: 0.1,
          threatBoost: 0.3,
          highlights: { summary: 'probe request' },
          tags: ['threat:shadow'],
          sourceKind: 'event',
          bssid: '11:22:33:44:55:66',
          ssid: 'lab-net',
          frameSubtype: 'probe_request',
          sequenceLogProb: -3.14,
          boostReasons: ['open_shadow_alert'],
          detailJson: '{"channel":11}',
        },
      ],
    });

    expect(response.query_id).toBe(42);
    expect(response.mode_used).toBe('SEARCH_MODE_SPARSE');
    expect(response.results[0]).toMatchObject({
      source_key: 'event:lab:001',
      source_table: 'wireless_frames',
      source_mac: 'aa:bb:cc:dd:ee:ff',
      location_id: 'lab',
      sensor_id: 'sensor-a',
      observed_at: '2026-06-02T12:00:00Z',
      cosine_similarity: 0,
      keyword_rank: 0.1,
      threat_boost: 0.3,
      source_kind: 'event',
      frame_subtype: 'probe_request',
      sequence_log_prob: -3.14,
      boost_reasons: ['open_shadow_alert'],
      detail_json: '{"channel":11}',
    });
  });

  it('uses backend error messages instead of raw error JSON', async () => {
    const error = await apiErrorFromResponse(
      new Response(
        JSON.stringify({
          error: 'search query is required and must contain meaningful terms',
        }),
        { status: 400, statusText: 'Bad Request' },
      ),
    );

    expect(error.message).toBe(
      'search query is required and must contain meaningful terms',
    );
  });
});
