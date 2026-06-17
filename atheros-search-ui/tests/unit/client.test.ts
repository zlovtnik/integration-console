import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiErrorFromResponse,
  normalizeInventoryResponse,
  normalizeSearchResponse,
  prepareGraphFilters,
  prepareSearchRequest,
  setOutgoingTimestampReporter,
} from '~/api/client';
import type { GraphFilters, SearchFilters } from '~/api/types';
import { asRfc3339 } from '~/utils/timestamp';

afterEach(() => {
  setOutgoingTimestampReporter(undefined);
  vi.restoreAllMocks();
});

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

  it('normalizes lowerCamelCase inventory responses', () => {
    const response = normalizeInventoryResponse({
      generatedAt: '2026-06-15T10:00:00Z',
      nodeCount: 2,
      edgeCount: 1,
      totalRegisteredCount: 12,
      nodes: [
        {
          id: 'device:badge-printer',
          kind: 'device',
          label: 'badge-printer',
          knownMacs: ['50:9a:4c:aa:34:10'],
          displayName: 'Badge Printer',
          ownerId: 'security',
          locationId: 'floor-2',
          firstRegistered: '2026-04-21T09:12:00Z',
          lastSeen: '2026-06-12T21:02:33Z',
          active: false,
          similarityClusterId: 'printer-randomized',
          tags: ['printer'],
        },
        {
          id: 'merge:badge-printer',
          kind: 'merge_candidate',
          label: 'Badge printer identity merge',
          active: true,
          dedupConfidence: 0.91,
        },
      ],
      edges: [
        {
          id: 'candidate:badge-printer',
          sourceId: 'merge:badge-printer',
          targetId: 'device:badge-printer',
          kind: 'merge_candidate',
          weight: 0.91,
        },
      ],
    });

    expect(response).toMatchObject({
      generated_at: '2026-06-15T10:00:00Z',
      node_count: 2,
      edge_count: 1,
      total_registered_count: 12,
    });
    expect(response.nodes[0]).toMatchObject({
      known_macs: ['50:9a:4c:aa:34:10'],
      display_name: 'Badge Printer',
      owner_id: 'security',
      location_id: 'floor-2',
      first_registered: '2026-04-21T09:12:00Z',
      last_seen: '2026-06-12T21:02:33Z',
      active: false,
      similarity_cluster_id: 'printer-randomized',
    });
    expect(response.nodes[1]).toMatchObject({
      kind: 'merge_candidate',
      dedup_confidence: 0.91,
    });
    expect(response.edges[0]).toMatchObject({
      source: 'merge:badge-printer',
      target: 'device:badge-printer',
      kind: 'merge_candidate',
      weight: 0.91,
    });
  });
});

describe('api client outgoing timestamp validation', () => {
  it('drops malformed search timestamp fields before serialization', () => {
    const reporter = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setOutgoingTimestampReporter(reporter);

    const request = prepareSearchRequest({
      query: 'probe',
      filters: {
        ssid: 'lab',
        observed_after: '2026-06-16T23:51',
      } as unknown as SearchFilters,
    });

    expect(request.filters).toMatchObject({ ssid: 'lab' });
    expect(request.filters?.observed_after).toBeUndefined();
    expect(reporter).toHaveBeenCalledWith('search', [
      {
        path: 'filters.observed_after',
        value: '2026-06-16T23:51',
      },
    ]);
  });

  it('keeps valid branded search timestamp fields', () => {
    const observedAfter = asRfc3339('2026-06-16T23:51:00Z');
    expect(observedAfter).toBeDefined();

    const request = prepareSearchRequest({
      query: 'probe',
      filters: { observed_after: observedAfter! },
    });

    expect(request.filters?.observed_after).toBe(observedAfter);
  });

  it('drops malformed graph timestamp fields before serialization', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const filters = prepareGraphFilters({
      limit: 200,
      observed_before: '2026-06-16T23:51',
    } as unknown as GraphFilters);

    expect(filters.limit).toBe(200);
    expect(filters.observed_before).toBeUndefined();
  });
});
