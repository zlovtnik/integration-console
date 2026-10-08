import { chromium, devices } from 'playwright';

// Use the real fixtures via dynamic import from compiled? We'll inline minimal mock matching fixtures mockApi behavior for graph.
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['Pixel 5'] });
const page = await context.newPage();

// Load real mockApi by running through the test runner instead - simpler: goto with no API and still inspect overlay after scroll
await page.route('**/v1/**', async (route) => {
  const url = route.request().url();
  const body = {
    generated_at: '2026-09-27T08:00:00Z',
    node_count: 5, edge_count: 4,
    nodes: [
      { id: 'cluster:7', kind: 'cluster', label: 'Rogue cluster', cluster_size: 2, event_source_macs: ['aa:bb:cc:dd:ee:ff'], first_seen: 'x', last_seen: 'y' },
      { id: 'ap:1', kind: 'ap', label: 'Lab AP', ssid: 'lab-net', bssid: '22:33:44:55:66:77', event_ssids: ['lab-net'], last_seen: 'y' },
    ],
    edges: [],
    aps: [{ id: 'ap:1', name: 'Lab AP', bssid: '22:33:44:55:66:77', observed_identifiers: 1, last_observed: '2026-09-27T07:00:00Z', evidence: 'Searchable evidence; coverage unverified' }],
    items: [],
    report: { grain: 'AP BSSID', count: 'distinct scoped identifiers', status: 'live', generated_at: '2026-09-27T08:00:00Z' },
  };
  if (url.includes('graph') || url.includes('network')) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [], nodes: [], edges: [], items: [] }) });
});

await page.goto('http://127.0.0.1:5173/graph', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// Mimic playwright scroll into view
const result = await page.evaluate(() => {
  const summary = [...document.querySelectorAll('summary')].find(s => s.textContent?.includes('Advanced projection explorer'));
  if (!summary) return { error: 'no summary' };
  summary.scrollIntoView({ block: 'center' });
  const sr = summary.getBoundingClientRect();
  const x = sr.left + sr.width / 2;
  const y = sr.top + sr.height / 2;
  const el = document.elementFromPoint(x, y);
  const chain = [];
  let p = el;
  for (let i = 0; i < 8 && p; i++) {
    const r = p.getBoundingClientRect();
    const s = getComputedStyle(p);
    chain.push({
      tag: p.tagName,
      cls: String(p.className).slice(0, 50),
      text: (p.textContent || '').trim().slice(0, 40),
      rect: { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right), h: Math.round(r.height) },
      position: s.position,
      zIndex: s.zIndex,
      pointerEvents: s.pointerEvents,
      overflow: s.overflow,
    });
    p = p.parentElement;
  }
  return {
    summaryRect: { t: Math.round(sr.top), b: Math.round(sr.bottom), l: Math.round(sr.left), r: Math.round(sr.right) },
    point: { x: Math.round(x), y: Math.round(y) },
    hit: chain,
  };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
