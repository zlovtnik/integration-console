import type { Page, Route } from '@playwright/test';

export const mockResult = {
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

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

export async function mockApi(page: Page) {
  await page.route('**/healthz', (route) => json(route, { status: 'ok' }));
  await page.route('**/v1/suggest/filters**', (route) =>
    json(route, {
      ssids: ['lab-net'],
      location_ids: ['lab'],
      sensor_ids: ['sensor-a'],
      frame_subtypes: ['probe_request', 'deauthentication'],
    }),
  );
  await page.route('**/v1/search', (route) =>
    json(route, {
      query_id: 1,
      results: [mockResult],
      mode_used: 'SEARCH_MODE_HYBRID',
      fallback_reason: '',
      dense_result_count: 1,
      sparse_result_count: 1,
      fused_result_count: 1,
    }),
  );
  await page.route('**/v1/search/stream', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: `${JSON.stringify(mockResult)}\n`,
    }),
  );
  await page.route('**/v1/explain/**', (route) =>
    json(route, {
      source_key: mockResult.source_key,
      dense_score: 0.72,
      sparse_score: 0.12,
      fused_score: 0.91,
      threat_boost: 0.07,
      boost_reasons: ['open_shadow_alert'],
      sequence_log_prob: -3.14,
      sequence_tokens: ['probe_request', 'deauthentication', 'association_request'],
      detail_json: mockResult.detail_json,
    }),
  );
}
