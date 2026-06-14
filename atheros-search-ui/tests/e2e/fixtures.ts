import type { Page, Route } from '@playwright/test';
import type { GraphResponse, SearchRequest, SearchResult } from '~/api/types';

export const mockResult: SearchResult = {
  source_key: 'event:lab:001',
  source_table: 'wireless_probe_observations',
  source_mac: 'aa:bb:cc:dd:ee:ff',
  location_id: 'lab',
  sensor_id: 'sensor-a',
  observed_at: '2026-06-02T12:00:00Z',
  score: 0.91,
  cosine_similarity: 0.72,
  keyword_rank: 0.12,
  threat_boost: 0.07,
  highlights: { summary: 'probe_request from lab client' },
  tags: ['threat:shadow'],
  source_kind: 'SEARCH_KIND_EVENT',
  bssid: '11:22:33:44:55:66',
  ssid: 'lab-net',
  frame_subtype: 'probe_request',
  sequence_log_prob: -3.14,
  boost_reasons: ['open_shadow_alert'],
  detail_json: JSON.stringify({ subtype: 'probe_request', channel: 11 }),
};

export const mockGraph: GraphResponse = {
  generated_at: '2026-06-02T12:01:00Z',
  node_count: 5,
  edge_count: 4,
  nodes: [
    {
      id: 'cluster:7',
      kind: 'cluster',
      label: 'Rogue cluster',
      cluster_size: 2,
      event_source_macs: ['aa:bb:cc:dd:ee:ff', '11:22:33:44:55:66'],
      first_seen: '2026-06-02T11:00:00Z',
      last_seen: '2026-06-02T12:00:00Z',
    },
    {
      id: 'device:aa:bb:cc:dd:ee:ff',
      kind: 'device',
      label: 'lab-client',
      mac: 'aa:bb:cc:dd:ee:ff',
      event_source_macs: ['aa:bb:cc:dd:ee:ff'],
      explain_source_key: 'aa:bb:cc:dd:ee:ff',
      explain_kind: 'SEARCH_KIND_DEVICE',
      first_seen: '2026-06-02T11:00:00Z',
      last_seen: '2026-06-02T12:00:00Z',
    },
    {
      id: 'device:11:22:33:44:55:66',
      kind: 'device',
      label: 'rotated-client',
      mac: '11:22:33:44:55:66',
      event_source_macs: ['11:22:33:44:55:66'],
      explain_source_key: '11:22:33:44:55:66',
      explain_kind: 'SEARCH_KIND_DEVICE',
      first_seen: '2026-06-02T11:30:00Z',
      last_seen: '2026-06-02T12:00:00Z',
    },
    {
      id: 'ap:1',
      kind: 'ap',
      label: 'lab-net',
      ssid: 'lab-net',
      bssid: '22:33:44:55:66:77',
      event_ssids: ['lab-net'],
      last_seen: '2026-06-02T12:00:00Z',
    },
    {
      id: 'client:lab-net|aa:bb:cc:dd:ee:ff',
      kind: 'client',
      label: 'aa:bb:cc:dd:ee:ff',
      mac: 'aa:bb:cc:dd:ee:ff',
      ssid: 'lab-net',
      bssid: '22:33:44:55:66:77',
      event_source_macs: ['aa:bb:cc:dd:ee:ff'],
      event_ssids: ['lab-net'],
      explain_source_key: 'aa:bb:cc:dd:ee:ff',
      explain_kind: 'SEARCH_KIND_DEVICE',
      last_seen: '2026-06-02T12:00:00Z',
    },
  ],
  edges: [
    {
      id: 'cluster_member:device:aa:bb:cc:dd:ee:ff:cluster:7',
      source: 'device:aa:bb:cc:dd:ee:ff',
      target: 'cluster:7',
      kind: 'cluster_member',
      label: 'cluster member',
    },
    {
      id: 'cluster_member:device:11:22:33:44:55:66:cluster:7',
      source: 'device:11:22:33:44:55:66',
      target: 'cluster:7',
      kind: 'cluster_member',
      label: 'cluster member',
    },
    {
      id: 'association:client:lab-net|aa:bb:cc:dd:ee:ff:ap:1',
      source: 'client:lab-net|aa:bb:cc:dd:ee:ff',
      target: 'ap:1',
      kind: 'association',
      label: 'association',
    },
    {
      id: 'probe:client:lab-net|aa:bb:cc:dd:ee:ff:ap:1',
      source: 'client:lab-net|aa:bb:cc:dd:ee:ff',
      target: 'ap:1',
      kind: 'probe',
      label: 'probe target',
    },
  ],
};

interface MockApiOptions {
  results?: SearchResult[];
  graph?: GraphResponse;
  onGraphRequest?: (body: unknown) => void;
  onSearchRequest?: (body: SearchRequest) => void;
}

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

export async function mockApi(page: Page, options: MockApiOptions = {}) {
  const results = options.results ?? [mockResult];
  const graph = options.graph ?? mockGraph;

  await page.route('**/healthz', (route) => json(route, { status: 'ok' }));
  await page.route('**/v1/suggest/filters**', (route) =>
    json(route, {
      ssids: ['lab-net'],
      location_ids: ['lab'],
      sensor_ids: ['sensor-a'],
      frame_subtypes: ['probe_request', 'deauthentication'],
    }),
  );
  await page.route('**/v1/search', (route) => {
    options.onSearchRequest?.(route.request().postDataJSON() as SearchRequest);
    return json(route, {
      query_id: 1,
      results,
      mode_used: 'SEARCH_MODE_HYBRID',
      fallback_reason: '',
      dense_result_count: results.length,
      sparse_result_count: results.length,
      fused_result_count: results.length,
    });
  });
  await page.route('**/v1/search/stream', (route) => {
    options.onSearchRequest?.(route.request().postDataJSON() as SearchRequest);
    return route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: results.map((result) => JSON.stringify(result)).join('\n') + '\n',
    });
  });
  await page.route('**/v1/graph', (route) => {
    options.onGraphRequest?.(route.request().postDataJSON());
    return json(route, graph);
  });
  await page.route('**/v1/explain/**', (route) =>
    json(route, {
      source_key: mockResult.source_key,
      dense_score: 0.72,
      sparse_score: 0.12,
      fused_score: 0.91,
      threat_boost: 0.07,
      boost_reasons: ['open_shadow_alert'],
      sequence_log_prob: -3.14,
      sequence_tokens: [
        'probe_request',
        'deauthentication',
        'association_request',
      ],
      detail_json: mockResult.detail_json,
    }),
  );
}
