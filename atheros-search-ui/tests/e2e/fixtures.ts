import type { Page, Route } from '@playwright/test';
import type {
  ETLHealth,
  GraphFilters,
  GraphResponse,
  InventoryResponse,
  InventoryFilters,
  NetworkResponse,
  NetworkFilters,
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

/**
 * A cmdb-grouped inventory: owner and location nodes plus the devices they own
 * and sit at, with the `owns` / `located_at` edges the detail panels derive
 * their members from.
 */
export const mockInventoryCmdb: InventoryResponse = {
  generated_at: '2026-09-27T12:00:00Z',
  node_count: 5,
  edge_count: 4,
  total_device_count: 3,
  total_registered_count: 2,
  nodes: [
    {
      id: 'owner:security',
      kind: 'owner',
      label: 'security',
      owner_id: 'security',
      active: true,
    },
    {
      id: 'owner:unassigned',
      kind: 'owner',
      label: 'unassigned',
      owner_id: 'unassigned',
      active: true,
    },
    {
      id: 'location:lab',
      kind: 'location_asset',
      label: 'lab',
      location_id: 'lab',
      active: true,
    },
    {
      id: 'device:aa:bb:cc:dd:ee:ff',
      kind: 'device',
      label: 'Lab identifier',
      mac: 'aa:bb:cc:dd:ee:ff',
      known_macs: ['aa:bb:cc:dd:ee:ff', 'aa:bb:cc:dd:ee:fe'],
      display_name: 'Lab identifier',
      owner_id: 'security',
      location_id: 'lab',
      active: true,
      registered: true,
      first_registered: '2026-09-01T00:00:00Z',
      first_seen: '2026-09-01T00:00:00Z',
      last_seen: '2026-09-27T11:00:00Z',
      tags: ['registered', 'active', 'owner:security', 'location:lab'],
    },
    {
      id: 'device:11:22:33:44:55:66',
      kind: 'device',
      label: '11:22:33:44:55:66',
      mac: '11:22:33:44:55:66',
      known_macs: ['11:22:33:44:55:66'],
      owner_id: 'security',
      location_id: 'lab',
      active: true,
      registered: false,
      first_seen: '2026-09-20T00:00:00Z',
      last_seen: '2026-09-26T11:00:00Z',
      tags: ['device', 'owner:security', 'location:lab'],
    },
  ],
  edges: [
    {
      id: 'owns:owner:security:device:aa:bb:cc:dd:ee:ff',
      source: 'owner:security',
      target: 'device:aa:bb:cc:dd:ee:ff',
      kind: 'owns',
    },
    {
      id: 'owns:owner:security:device:11:22:33:44:55:66',
      source: 'owner:security',
      target: 'device:11:22:33:44:55:66',
      kind: 'owns',
    },
    {
      id: 'located_at:device:aa:bb:cc:dd:ee:ff:location:lab',
      source: 'device:aa:bb:cc:dd:ee:ff',
      target: 'location:lab',
      kind: 'located_at',
    },
    {
      id: 'located_at:device:11:22:33:44:55:66:location:lab',
      source: 'device:11:22:33:44:55:66',
      target: 'location:lab',
      kind: 'located_at',
    },
  ],
};

/**
 * A similarity-grouped inventory. `similarity_cluster_id` is a pending merge
 * candidate id, not a confirmed identity cluster.
 */
export const mockInventorySimilarity: InventoryResponse = {
  generated_at: '2026-09-27T12:00:00Z',
  node_count: 4,
  edge_count: 4,
  total_device_count: 2,
  total_registered_count: 1,
  nodes: [
    {
      id: 'cluster:pair-1',
      kind: 'cluster',
      label: 'Similarity pair1',
      similarity_cluster_id: 'pair-1',
      active: true,
      tags: ['similarity:pending'],
    },
    {
      id: 'merge:pair-1',
      kind: 'merge_candidate',
      label: 'aa:bb:cc:dd:ee:ff / 11:22:33:44:55:66',
      similarity_cluster_id: 'pair-1',
      dedup_confidence: 0.91,
      active: true,
      tags: ['merge-review'],
    },
    {
      id: 'device:aa:bb:cc:dd:ee:ff',
      kind: 'device',
      label: 'Lab identifier',
      mac: 'aa:bb:cc:dd:ee:ff',
      known_macs: ['aa:bb:cc:dd:ee:ff'],
      display_name: 'Lab identifier',
      owner_id: 'security',
      location_id: 'lab',
      active: true,
      registered: true,
      first_seen: '2026-09-01T00:00:00Z',
      last_seen: '2026-09-27T11:00:00Z',
      tags: ['registered'],
    },
    {
      id: 'device:11:22:33:44:55:66',
      kind: 'device',
      label: '11:22:33:44:55:66',
      mac: '11:22:33:44:55:66',
      known_macs: ['11:22:33:44:55:66'],
      owner_id: 'security',
      location_id: 'lab',
      active: true,
      registered: false,
      first_seen: '2026-09-20T00:00:00Z',
      last_seen: '2026-09-26T11:00:00Z',
      tags: ['device'],
    },
  ],
  edges: [
    {
      id: 'cluster_member:device:aa:bb:cc:dd:ee:ff:cluster:pair-1',
      source: 'device:aa:bb:cc:dd:ee:ff',
      target: 'cluster:pair-1',
      kind: 'cluster_member',
    },
    {
      id: 'cluster_member:device:11:22:33:44:55:66:cluster:pair-1',
      source: 'device:11:22:33:44:55:66',
      target: 'cluster:pair-1',
      kind: 'cluster_member',
    },
    {
      id: 'merge_candidate:merge:pair-1:device:aa:bb:cc:dd:ee:ff',
      source: 'merge:pair-1',
      target: 'device:aa:bb:cc:dd:ee:ff',
      kind: 'merge_candidate',
    },
    {
      id: 'merge_candidate:merge:pair-1:device:11:22:33:44:55:66',
      source: 'merge:pair-1',
      target: 'device:11:22:33:44:55:66',
      kind: 'merge_candidate',
    },
  ],
};

interface MockApiOptions {
  inventory?: (body: InventoryFilters) => InventoryResponse;
  network?: (body: NetworkFilters) => NetworkResponse;
  onInventoryRequest?: (body: InventoryFilters) => void;
  onNetworkRequest?: (body: NetworkFilters) => void;
  results?: SearchResult[];
  graph?: GraphResponse | ((body: unknown) => GraphResponse);
  onGraphRequest?: (body: unknown) => void;
  onSearchRequest?: (body: SearchRequest) => void;
  etlHealth?: Partial<ETLHealth>;
  search?: (body: SearchRequest) => Partial<Record<string, unknown>>;
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
  await page.route('**/v1/etl/health', (route) =>
    json(route, {
      measured_at: '2026-09-27T12:00:00Z',
      wireless_events_24h: 12,
      wireless_last_observed_at: '2026-09-27T11:59:00Z',
      wireless_projection: 'fresh',
      ingest_pending: 1,
      ingest_processing: 0,
      ingest_failed: 0,
      embedding_pending: 2,
      embedding_failed: 0,
      embedding_dependency: 'healthy',
      query_semantic: {
        preflight: 'compatible',
        circuit_state: 'closed',
        backend_available: true,
        last_check_at: '2026-09-27T12:00:00Z',
        last_success_at: '2026-09-27T11:59:30Z',
      },
      worker_semantic: {
        preflight: 'compatible',
        circuit_state: 'closed',
        backend_available: true,
        last_check_at: '2026-09-27T12:00:00Z',
        last_success_at: '2026-09-27T11:59:30Z',
      },
      ...options.etlHealth,
    }),
  );
  await page.route('**/v1/inventory', (route) => {
    const body = route.request().postDataJSON() as InventoryFilters;
    options.onInventoryRequest?.(body);
    // Grouping decides which non-device nodes the projection carries, so the
    // default mock mirrors the API rather than always returning one device.
    const grouped =
      body.grouping === 'cmdb'
        ? mockInventoryCmdb
        : body.grouping === 'similarity'
          ? mockInventorySimilarity
          : {
              generated_at: '2026-09-27T12:00:00Z',
              node_count: 1,
              edge_count: 0,
              total_device_count: 1,
              total_registered_count: 0,
              nodes: [
                {
                  id: 'device:aa:bb:cc:dd:ee:ff',
                  mac: 'aa:bb:cc:dd:ee:ff',
                  kind: 'device' as const,
                  label: 'Lab identifier',
                  display_name: 'Lab identifier',
                  owner_id: 'security',
                  location_id: 'lab',
                  known_macs: ['aa:bb:cc:dd:ee:ff'],
                  active: true,
                  registered: false,
                  pending_review_count: 0,
                  first_seen: '2026-09-01T00:00:00Z',
                  first_registered: '2026-09-02T00:00:00Z',
                  last_seen: '2026-09-27T11:00:00Z',
                  tags: ['device', 'owner:security', 'location:lab'],
                },
              ],
              edges: [],
            };
    return json(route, options.inventory?.(body) ?? grouped);
  });
  await page.route('**/v1/network-map', (route) => {
    const body = route.request().postDataJSON() as NetworkFilters;
    options.onNetworkRequest?.(body);
    return json(
      route,
      options.network?.(body) ?? {
        access_points: [
          {
            bssid: '22:33:44:55:66:77',
            name: 'Lab AP',
            identifier_count: 1,
            first_observed: '2026-09-27T10:00:00Z',
            last_observed: '2026-09-27T11:00:00Z',
            evidence_status: 'Searchable evidence; coverage unverified',
          },
        ],
        roster: body.ap_bssid
          ? [
              {
                mac: 'aa:bb:cc:dd:ee:ff',
                name: 'Lab identifier',
                first_observed: '2026-09-27T10:00:00Z',
                last_observed: '2026-09-27T11:00:00Z',
                record_count: 2,
              },
            ]
          : [],
        nodes: body.ap_bssid
          ? [
              { id: 'ap:' + body.ap_bssid, kind: 'ap', label: 'Lab AP' },
              {
                id: 'device:aa:bb:cc:dd:ee:ff',
                kind: 'device',
                label: 'Lab identifier',
                mac: 'aa:bb:cc:dd:ee:ff',
              },
            ]
          : [],
        edges: body.ap_bssid
          ? [
              {
                id: 'e1',
                source: 'device:aa:bb:cc:dd:ee:ff',
                target: 'ap:' + body.ap_bssid,
                kind: 'association',
                weight: 2,
                weight_basis: 'searchable_record_count',
              },
            ]
          : [],
        generated_at: '2026-09-27T12:00:00Z',
        total_rows: 1,
        report: {
          scope: body,
          entity_grain: body.ap_bssid ? 'observed MAC identifier' : 'AP BSSID',
          count_meaning: 'distinct scoped identifiers',
          observation_basis: 'retained searchable records',
          freshness: 'unavailable',
          loaded_rows: 1,
          total_rows: 1,
          incomplete_coverage: true,
          unavailable_capabilities: ['sensor_coverage'],
          live: true,
        },
      },
    );
  });

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
    const body = route.request().postDataJSON() as SearchRequest;
    options.onSearchRequest?.(body);
    return json(route, {
      query_id: 1,
      results,
      mode_used: 'SEARCH_MODE_HYBRID',
      fallback_reason: '',
      fallback_code: '',
      dense_result_count: results.length,
      sparse_result_count: results.length,
      fused_result_count: results.length,
      ...(options.search?.(body) ?? {}),
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
