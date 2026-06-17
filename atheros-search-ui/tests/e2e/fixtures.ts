import type { Page, Route } from '@playwright/test';
import type {
  GraphFilters,
  GraphResponse,
  SearchRequest,
  SearchResult,
} from '~/api/types';

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

export const mockMultiSsidGraph: GraphResponse = {
  generated_at: '2026-06-02T12:02:00Z',
  node_count: 8,
  edge_count: 4,
  nodes: [
    {
      id: 'cluster:lab',
      kind: 'cluster',
      label: 'Lab cluster',
      cluster_size: 1,
      event_source_macs: ['aa:bb:cc:dd:ee:ff'],
      event_ssids: ['lab-net'],
      last_seen: '2026-06-02T12:00:00Z',
    },
    {
      id: 'device:aa:bb:cc:dd:ee:ff',
      kind: 'device',
      label: 'lab-client',
      mac: 'aa:bb:cc:dd:ee:ff',
      event_source_macs: ['aa:bb:cc:dd:ee:ff'],
      last_seen: '2026-06-02T12:00:00Z',
    },
    {
      id: 'ap:observed:lab-net|22:33:44:55:66:77|lab',
      kind: 'ap',
      label: 'lab-net',
      ssid: 'lab-net',
      bssid: '22:33:44:55:66:77',
      location_id: 'lab',
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
      last_seen: '2026-06-02T12:00:00Z',
    },
    {
      id: 'cluster:guest',
      kind: 'cluster',
      label: 'Guest cluster',
      cluster_size: 1,
      event_source_macs: ['66:55:44:33:22:11'],
      event_ssids: ['guest-net'],
      last_seen: '2026-06-02T11:45:00Z',
    },
    {
      id: 'ap:observed:guest-net|77:66:55:44:33:22|guest',
      kind: 'ap',
      label: 'guest-net',
      ssid: 'guest-net',
      bssid: '77:66:55:44:33:22',
      location_id: 'guest',
      event_ssids: ['guest-net'],
      last_seen: '2026-06-02T11:45:00Z',
    },
    {
      id: 'client:guest-net|66:55:44:33:22:11',
      kind: 'client',
      label: '66:55:44:33:22:11',
      mac: '66:55:44:33:22:11',
      ssid: 'guest-net',
      bssid: '77:66:55:44:33:22',
      event_source_macs: ['66:55:44:33:22:11'],
      event_ssids: ['guest-net'],
      last_seen: '2026-06-02T11:45:00Z',
    },
    {
      id: 'shadow_alert:guest',
      kind: 'shadow_alert',
      label: 'Guest shadow',
      mac: '66:55:44:33:22:11',
      ssid: 'guest-net',
      event_source_macs: ['66:55:44:33:22:11'],
      event_ssids: ['guest-net'],
      last_seen: '2026-06-02T11:45:00Z',
    },
  ],
  edges: [
    {
      id: 'cluster_member:device:aa:bb:cc:dd:ee:ff:cluster:lab',
      source: 'device:aa:bb:cc:dd:ee:ff',
      target: 'cluster:lab',
      kind: 'cluster_member',
      label: 'cluster member',
    },
    {
      id: 'association:client:lab-net|aa:bb:cc:dd:ee:ff:ap:observed:lab-net|22:33:44:55:66:77|lab',
      source: 'client:lab-net|aa:bb:cc:dd:ee:ff',
      target: 'ap:observed:lab-net|22:33:44:55:66:77|lab',
      kind: 'association',
      label: 'association',
    },
    {
      id: 'association:client:guest-net|66:55:44:33:22:11:ap:observed:guest-net|77:66:55:44:33:22|guest',
      source: 'client:guest-net|66:55:44:33:22:11',
      target: 'ap:observed:guest-net|77:66:55:44:33:22|guest',
      kind: 'association',
      label: 'association',
    },
    {
      id: 'shadow:shadow_alert:guest:client:guest-net|66:55:44:33:22:11',
      source: 'shadow_alert:guest',
      target: 'client:guest-net|66:55:44:33:22:11',
      kind: 'shadow',
      label: 'shadow alert',
    },
  ],
};

export function graphForFilters(body: unknown): GraphResponse {
  const filters = body as GraphFilters;
  if (filters?.ssid?.trim() === 'lab-net') {
    const allowed = new Set(
      mockMultiSsidGraph.nodes
        .filter((node) => {
          if (node.id === 'cluster:lab') return true;
          return (
            node.ssid === 'lab-net' || node.event_ssids?.includes('lab-net')
          );
        })
        .map((node) => node.id),
    );
    const nodes = mockMultiSsidGraph.nodes.filter((node) =>
      allowed.has(node.id),
    );
    const edges = mockMultiSsidGraph.edges.filter(
      (edge) => allowed.has(edge.source) && allowed.has(edge.target),
    );
    return {
      ...mockMultiSsidGraph,
      node_count: nodes.length,
      edge_count: edges.length,
      nodes,
      edges,
    };
  }
  return mockMultiSsidGraph;
}

interface MockApiOptions {
  results?: SearchResult[];
  graph?: GraphResponse | ((body: unknown) => GraphResponse);
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
    const body = route.request().postDataJSON();
    options.onGraphRequest?.(body);
    return json(route, typeof graph === 'function' ? graph(body) : graph);
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
