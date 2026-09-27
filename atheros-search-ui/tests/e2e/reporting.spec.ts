import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockApi } from './fixtures';
import type {
  InventoryFilters,
  InventoryResponse,
  SearchRequest,
} from '~/api/types';

const stamp = '2026-09-27T12:00:00Z';
function inventory(body: InventoryFilters): InventoryResponse {
  const mac =
    body.source_macs?.[0] ??
    (body.page_cursor ? 'aa:bb:cc:dd:ee:02' : 'aa:bb:cc:dd:ee:01');
  return {
    generated_at: stamp,
    nodes: [
      {
        id: 'device:' + mac,
        mac,
        kind: 'device',
        label: 'Identifier ' + mac.slice(-2),
        active: true,
        registered: body.registered ?? false,
        pending_review_count: 0,
        last_seen: stamp,
      },
    ],
    edges: [],
    node_count: 1,
    edge_count: 0,
    total_device_count: 2,
    total_registered_count: body.registered ? 2 : 0,
    ...(!body.page_cursor && !body.source_macs
      ? { next_page_cursor: 'second' }
      : {}),
  };
}

test('inventory uses bounded server presets, pages, and independent row detail', async ({
  page,
}) => {
  const requests: InventoryFilters[] = [];
  const graphs: unknown[] = [];
  await mockApi(page, {
    inventory,
    onInventoryRequest: (body) => requests.push(body),
    onGraphRequest: (body) => graphs.push(body),
  });
  await page.goto('/inventory?loc=lab&sensor=sensor-a');
  await expect(
    page.getByRole('table', {
      name: 'Observed MAC identifiers; one row per MAC',
    }),
  ).toBeVisible();
  expect(requests[0]).toMatchObject({
    scope: 'page',
    page_size: 50,
    location_ids: ['lab'],
    sensor_ids: ['sensor-a'],
  });
  expect(graphs).toHaveLength(0);
  await page
    .getByRole('combobox', { name: /Identifiers/ })
    .selectOption('registered');
  await expect
    .poll(() => requests.some((body) => body.registered === true))
    .toBe(true);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(
    page.getByRole('button', { name: 'aa:bb:cc:dd:ee:02', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'aa:bb:cc:dd:ee:02', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'aa:bb:cc:dd:ee:02', exact: true })
    .click();
  await expect
    .poll(() =>
      requests.some((body) => body.source_macs?.[0] === 'aa:bb:cc:dd:ee:02'),
    )
    .toBe(true);
  await expect(page.getByRole('complementary')).toContainText('Registered');
  await page.getByRole('button', { name: 'Close inventory details' }).click();
  await page.goBack();
  await expect(
    page.getByRole('button', { name: 'aa:bb:cc:dd:ee:02', exact: true }),
  ).toBeVisible();
});

test('AP selection, roster member and Search carry the same scope', async ({
  page,
}) => {
  const searches: SearchRequest[] = [];
  await mockApi(page, { onSearchRequest: (body) => searches.push(body) });
  await page.goto(
    '/graph?loc=lab&sensor=sensor-a&after=2026-09-01T00%3A00%3A00Z',
  );
  await page.getByRole('button', { name: 'Lab AP', exact: true }).click();
  await expect(
    page.getByText('1 distinct identifiers; 1 shown.'),
  ).toBeVisible();
  await expect(page.locator('.network-focus-canvas .graph-node')).toHaveCount(
    2,
  );
  await page
    .getByRole('button', { name: 'Lab identifier', exact: true })
    .click();
  await expect(page.getByRole('complementary')).toBeVisible();
  await page
    .getByRole('link', { name: 'Search evidence', exact: true })
    .click();
  await expect
    .poll(() =>
      searches.some(
        (body) =>
          body.filters?.bssid === '22:33:44:55:66:77' &&
          body.filters?.observed_ap_context_only === true &&
          body.filters?.sensor_ids?.[0] === 'sensor-a' &&
          body.filters?.location_ids?.[0] === 'lab',
      ),
    )
    .toBe(true);
});

test('direct roster detail resolves scoped evidence without a registry row or map cache', async ({
  page,
}) => {
  const networkRequests: { source_macs?: string[] }[] = [];
  await mockApi(page, {
    network: (body) => ({
      access_points: [],
      roster: [
        {
          mac: 'aa:bb:cc:dd:ee:ff',
          name: '',
          first_observed: stamp,
          last_observed: stamp,
          record_count: 2,
        },
      ],
      nodes: [],
      edges: [],
      generated_at: stamp,
      total_rows: 1,
      report: {
        scope: body,
        entity_grain: 'observed MAC identifier',
        count_meaning: 'distinct scoped MACs',
        observation_basis: 'searchable records',
        freshness: 'unavailable',
        loaded_rows: 1,
        total_rows: 1,
        incomplete_coverage: true,
        unavailable_capabilities: ['sensor_coverage'],
        live: true,
      },
    }),
    inventory: () => ({
      generated_at: stamp,
      nodes: [],
      edges: [],
      node_count: 0,
      edge_count: 0,
      total_device_count: 0,
      total_registered_count: 0,
    }),
    onNetworkRequest: (body) => networkRequests.push(body),
  });
  await page.goto(
    '/graph?ap=22:33:44:55:66:77&node=device:aa:bb:cc:dd:ee:ff&loc=lab',
  );
  await expect(
    page.getByRole('complementary', { name: 'Identifier evidence' }),
  ).toBeVisible();
  await expect(
    page.getByRole('complementary', { name: 'Identifier evidence' }),
  ).toContainText('Unknown');
  await expect(
    page.getByRole('link', { name: 'Search identifier evidence' }),
  ).toBeVisible();
  expect(
    networkRequests.some(
      (request) => request.source_macs?.[0] === 'aa:bb:cc:dd:ee:ff',
    ),
  ).toBe(true);
});

test('direct identifier detail cannot widen the selected MAC scope', async ({
  page,
}) => {
  const requests: { source_macs?: string[] }[] = [];
  await mockApi(page, { onNetworkRequest: (body) => requests.push(body) });
  await page.goto(
    '/graph?ap=22:33:44:55:66:77&mac=aa:bb:cc:dd:ee:ff&node=device:11:22:33:44:55:66',
  );
  await expect(page.getByRole('alert')).toContainText(
    'outside the selected MAC scope',
  );
  expect(
    requests.some((request) =>
      request.source_macs?.includes('11:22:33:44:55:66'),
    ),
  ).toBe(false);
});

test('Graph node Explain and return retain investigation scope', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto(
    '/graph?loc=lab&sensor=sensor-a&after=2026-09-01T00%3A00%3A00Z',
  );
  await page.getByText('Advanced projection explorer', { exact: true }).click();
  await page.getByRole('button', { name: 'Open projection explorer' }).click();
  const focusedNode = page.locator(
    '.graph-node[data-node-id="device:aa:bb:cc:dd:ee:ff"]',
  );
  await focusedNode.focus();
  await page.keyboard.press('Enter');
  await expect(focusedNode).toHaveClass(/selected/);
  await page.getByRole('link', { name: 'Explain', exact: true }).click();
  await page.getByRole('link', { name: /Back to results/ }).click();
  await expect
    .poll(() => {
      const url = new URL(page.url());
      return [
        url.pathname,
        url.searchParams.get('loc'),
        url.searchParams.get('sensor'),
        url.searchParams.get('after'),
        url.searchParams.get('g_edges'),
      ];
    })
    .toEqual([
      '/graph',
      'lab',
      'sensor-a',
      '2026-09-01T00:00:00Z',
      'association',
    ]);
});

test('queue pair evidence survives a failed final decision and retry', async ({
  page,
}) => {
  await mockApi(page, {
    inventory: (body) =>
      body.scope === 'all'
        ? {
            generated_at: stamp,
            nodes: [
              {
                id: 'merge:pair',
                kind: 'merge_candidate',
                label: 'Pair review',
                active: true,
                dedup_confidence: 0.8,
              },
            ],
            edges: [],
            node_count: 1,
            edge_count: 0,
            total_registered_count: 0,
          }
        : {
            generated_at: stamp,
            nodes: [],
            edges: [],
            node_count: 0,
            edge_count: 0,
            total_registered_count: 0,
          },
  });
  await page.route('**/v1/inventory/merge-candidates/pair', (route) =>
    route.fulfill({
      json: {
        candidate_id: 'pair',
        mac_a: 'a',
        mac_b: 'b',
        confidence: 0.8,
        computed_at: stamp,
        status: 'pending',
        evidence: { method: 'fingerprint', conflicts: ['owner'] },
        projection_run_id: 'run',
        devices: [
          {
            id: 'device:a',
            kind: 'device',
            label: 'Independent A',
            active: true,
          },
          {
            id: 'device:b',
            kind: 'device',
            label: 'Independent B',
            active: true,
          },
        ],
      },
    }),
  );
  let attempts = 0;
  await page.route(
    '**/v1/inventory/merge-candidates/pair/decision',
    (route) => {
      attempts++;
      return route.fulfill(
        attempts === 1
          ? { status: 500, json: { message: 'Decision failed' } }
          : {
              json: {
                candidate_id: 'pair',
                decision: 'needs_more_data',
                accepted: true,
                decided_by: 'operator',
                decided_at: stamp,
              },
            },
      );
    },
  );
  await page.goto('/inventory?view=dedup_queue&limit=100');
  await page.getByRole('button', { name: 'Pair review', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Independent A' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Needs more data', exact: true })
    .click();
  await expect(page.getByText(/Retry the decision using/)).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Independent B' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Needs more data', exact: true })
    .click();
  await expect(
    page.getByText(/Decision recorded: needs_more_data/),
  ).toBeVisible();
  expect(attempts).toBe(2);
});

for (const width of [375, 768, 1024, 1440]) {
  test(
    'reports accessible at ' + width + 'px with reduced motion',
    async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await mockApi(page);
      for (const route of ['/inventory', '/graph']) {
        await page.goto(route);
        await expect(
          page.getByRole('link', { name: 'Graph', exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole('link', { name: 'Inventory', exact: true }),
        ).toBeVisible();
        await expect(page.getByRole('table').first()).toBeVisible();
        if (route === '/graph') {
          await page
            .getByRole('button', { name: 'Lab AP', exact: true })
            .focus();
          await page.keyboard.press('Enter');
          await expect(
            page.getByRole('table', { name: /AP roster/ }),
          ).toBeVisible();
        }
        const scan = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze();
        expect(
          scan.violations.filter((v) =>
            ['critical', 'serious'].includes(v.impact ?? ''),
          ),
        ).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(route.slice(1) + '-' + width + '.png'),
          fullPage: true,
        });
      }
    },
  );
}
