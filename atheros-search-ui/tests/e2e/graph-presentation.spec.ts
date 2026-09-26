import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { GraphResponse, InventoryResponse } from '~/api/types';
import { mockApi } from './fixtures';

const graph: GraphResponse = {
  generated_at: '2026-09-26T12:00:00Z',
  node_count: 6,
  edge_count: 3,
  nodes: [
    { id: 'anchor', kind: 'ap', label: 'Lab access point' },
    { id: 'client', kind: 'client', label: 'Lab laptop' },
    { id: 'threat', kind: 'shadow_alert', label: 'Shadow AP' },
    { id: 'alert', kind: 'alert', label: 'Probe sweep' },
    {
      id: 'cluster',
      kind: 'cluster',
      label: 'Identity cluster',
      cluster_size: 3,
    },
    { id: 'isolated', kind: 'device', label: 'Printer' },
  ],
  edges: [
    {
      id: 'association',
      source: 'anchor',
      target: 'client',
      kind: 'association',
    },
    { id: 'shadow', source: 'anchor', target: 'threat', kind: 'shadow' },
    { id: 'probe', source: 'alert', target: 'client', kind: 'probe' },
  ],
};

const inventory: InventoryResponse = {
  generated_at: graph.generated_at,
  node_count: 6,
  edge_count: 3,
  total_registered_count: 2,
  nodes: [
    { id: 'anchor', kind: 'owner', label: 'Network team', active: true },
    { id: 'client', kind: 'device', label: 'Lab laptop', active: true },
    {
      id: 'threat',
      kind: 'merge_candidate',
      label: 'Identity review',
      active: true,
    },
    {
      id: 'location',
      kind: 'location_asset',
      label: 'Laboratory',
      active: true,
    },
    { id: 'cluster', kind: 'cluster', label: 'Identity cluster', active: true },
    { id: 'isolated', kind: 'device', label: 'Printer', active: false },
  ],
  edges: [
    { id: 'owns', source: 'anchor', target: 'client', kind: 'owns' },
    {
      id: 'merge',
      source: 'anchor',
      target: 'threat',
      kind: 'merge_candidate',
    },
    { id: 'located', source: 'location', target: 'client', kind: 'located_at' },
  ],
};

async function openGraph(page: Page, path: string) {
  await mockApi(page, { graph });
  await page.route('**/v1/inventory', (route) =>
    route.fulfill({ json: inventory }),
  );
  await page.goto(path);
  await expect(page.locator('.graph-node')).toHaveCount(6);
}

const node = (page: Page, id: string) =>
  page.locator(`.graph-node[data-node-id="${id}"]`);

for (const path of ['/graph', '/inventory']) {
  test(`${path}: focus and hover preview visible neighbors without changing selection`, async ({
    page,
  }) => {
    await openGraph(page, path);
    const anchor = node(page, 'anchor');
    const isolated = node(page, 'isolated');
    await anchor.focus();
    await page.keyboard.press('Enter');
    await expect(anchor).toHaveClass(/selected/);
    await isolated.focus();
    await expect(anchor).toHaveClass(/dimmed/);
    await expect(anchor).toHaveAttribute('aria-pressed', 'true');
    const viewport = page.locator('.graph-viewport');
    const before = await viewport.getAttribute('transform');
    await anchor.dispatchEvent('mouseenter');
    await expect(node(page, 'client')).toHaveClass(/related/);
    await expect(isolated).toHaveClass(/dimmed/);
    expect(await viewport.getAttribute('transform')).toBe(before);
    await anchor.dispatchEvent('mouseleave');
    await page.locator('#main-content').focus();
    await expect(anchor).not.toHaveClass(/dimmed/);
    await expect(node(page, 'client')).toHaveClass(/related/);

    if (path === '/graph') {
      await page.getByRole('button', { name: /^Edges/ }).click();
      await page
        .getByRole('button', { name: 'Device-AP association', exact: true })
        .click();
      await expect(node(page, 'client')).toHaveClass(/dimmed/);
      await page.keyboard.press('Escape');
    } else {
      await page
        .getByRole('button', { name: 'Merge candidate', exact: true })
        .focus();
      await page.keyboard.press('Space');
      await expect(node(page, 'threat')).toBeHidden();
      await expect(
        page.locator('.inventory-link[data-edge-kind="merge_candidate"]'),
      ).toBeHidden();
    }
  });

  test(`${path}: glow survives settling and rebuilds, respects reduced motion`, async ({
    page,
  }, testInfo) => {
    await openGraph(page, path);
    const glow = node(page, 'threat').locator('.graph-node-glow');
    await expect(glow).toHaveCSS('animation-duration', '2.4s');
    await expect(glow).toHaveCSS('animation-name', 'graph-threat-pulse');
    await expect(async () => {
      const before = await node(page, 'threat').getAttribute('transform');
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );
      expect(await node(page, 'threat').getAttribute('transform')).toBe(before);
    }).toPass({ timeout: 15000 });
    const firstOpacity = await glow.evaluate(
      (element) => getComputedStyle(element).opacity,
    );
    await expect
      .poll(() => glow.evaluate((element) => getComputedStyle(element).opacity))
      .not.toBe(firstOpacity);
    await page.screenshot({
      path: testInfo.outputPath('dark.png'),
      fullPage: true,
    });
    await page.evaluate(() =>
      document.documentElement.setAttribute('data-theme', 'light'),
    );
    await page.screenshot({
      path: testInfo.outputPath('light.png'),
      fullPage: true,
    });
    await expect(page.locator('.graph-canvas')).toHaveCSS(
      'background-size',
      '28px 28px',
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(glow).toHaveCSS('animation-name', 'none');
    await expect(glow).toHaveCSS('opacity', '0.45');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(node(page, 'threat').locator('.graph-node-glow')).toHaveCount(
      1,
    );
    await expect(page.locator('.graph-canvas defs')).toHaveCount(1);
    const ids = await page
      .locator('.graph-canvas [id]')
      .evaluateAll((elements) => elements.map((element) => element.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(await page.locator('.graph-viewport').innerHTML()).not.toContain(
      'NaN',
    );
    const results = await new AxeBuilder({ page })
      .include('.graph-canvas')
      .analyze();
    expect(
      results.violations.filter((violation) =>
        ['serious', 'critical'].includes(violation.impact ?? ''),
      ),
    ).toEqual([]);
  });

  test(`${path}: dismiss selection and preserve it during desktop panning`, async ({
    page,
    isMobile,
  }) => {
    await openGraph(page, path);
    await node(page, 'anchor').focus();
    await page.keyboard.press('Enter');
    await page.locator('#main-content').focus();
    await expect(node(page, 'anchor')).toHaveClass(/selected/);
    if (isMobile) {
      // The existing bottom sheet covers the canvas on small screens.
      await page.keyboard.press('Escape');
      await expect(node(page, 'anchor')).not.toHaveClass(/selected/);
      return;
    }
    const canvas = page.locator('.graph-canvas');
    await canvas.scrollIntoViewIfNeeded();
    const bounds = (await canvas.boundingBox())!;
    await page.mouse.move(bounds.x + 8, bounds.y + 8);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 48, bounds.y + 28, { steps: 5 });
    await page.mouse.up();
    await expect(node(page, 'anchor')).toHaveClass(/selected/);
    await canvas.click({ position: { x: 8, y: 8 } });
    await expect(node(page, 'anchor')).not.toHaveClass(/selected/);

    await node(page, 'anchor').focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Pin node', exact: true }).click();
    await page.keyboard.press('Escape');
    const anchor = node(page, 'anchor');
    await expect(anchor).toHaveClass(/pinned/);
    const body = (await anchor.locator('.graph-node-body').boundingBox())!;
    const previous = await anchor.getAttribute('transform');
    await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      body.x + body.width / 2 - 35,
      body.y + body.height / 2 - 15,
      { steps: 5 },
    );
    await page.mouse.up();
    await expect(anchor).not.toHaveAttribute('transform', previous!);
    await expect(anchor).not.toHaveClass(/selected/);
    const pinned = await anchor.getAttribute('transform');
    await page.getByRole('button', { name: 'Reset view', exact: true }).click();
    await expect(anchor).toHaveAttribute('transform', pinned!);
  });

  test(`${path}: aggregate circles display counts and expand with the keyboard`, async ({
    page,
  }) => {
    await mockApi(page);
    const devices = Array.from({ length: 401 }, (_, index) => ({
      id: `device:${index}`,
      kind: 'device' as const,
      label: `Device ${index}`,
      active: true,
    }));
    const response =
      path === '/graph'
        ? {
            ...graph,
            nodes: [
              { id: 'ap:lab', kind: 'ap', label: 'Lab access point' },
              ...devices,
            ],
            edges: devices.map((device) => ({
              id: `edge:${device.id}`,
              source: device.id,
              target: 'ap:lab',
              kind: 'association',
            })),
            node_count: 402,
            edge_count: 401,
          }
        : {
            ...inventory,
            nodes: devices,
            edges: [],
            node_count: 401,
            edge_count: 0,
            total_registered_count: 401,
          };
    await page.route(`**/v1${path}`, (route) =>
      route.fulfill({ json: response }),
    );
    await page.goto(path);
    const aggregate = page.locator('.graph-node[data-kind="aggregate_group"]');
    await expect(aggregate.locator('circle.graph-node-body')).toHaveCount(1);
    await expect(aggregate.locator('.graph-node-symbol')).toHaveText('401');
    await aggregate.focus();
    await page.keyboard.press('Enter');
    await expect(aggregate).toHaveCount(0);
    await expect(page.locator('.graph-node[data-kind="device"]')).toHaveCount(
      401,
    );
    await expect(page.locator('.graph-canvas defs')).toHaveCount(1);
  });
}
