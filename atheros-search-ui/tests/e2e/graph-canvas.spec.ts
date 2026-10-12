import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { GraphResponse } from '~/api/types';
import { mockApi } from './fixtures';

function denseGraph(count: number): GraphResponse {
  const aps = Array.from({ length: 4 }, (_, index) => ({ id: `ap:${index}`, kind: 'ap' as const, label: `Wireless AP ${index + 1}` }));
  const devices = Array.from({ length: count }, (_, index) => ({
    id: `device:${index}`, kind: 'device' as const, label: `Observed device ${index + 1}`,
    parent_id: aps[index % aps.length]!.id,
  }));
  return {
    generated_at: '2026-10-11T12:00:00Z', node_count: aps.length + count, edge_count: count,
    nodes: [...aps, ...devices],
    edges: devices.map((node) => ({ id: `edge:${node.id}`, source: node.id, target: node.parent_id, kind: 'association' as const })),
  };
}

test('dense observations load above the fold with a balanced, finite initial fit', async ({ page }, testInfo) => {
  await mockApi(page, { graph: denseGraph(240) });
  await page.goto('/graph');
  const canvas = page.locator('.graph-workspace .graph-canvas');
  await expect(canvas).toHaveAttribute('data-layout', 'groups');
  await expect(canvas.locator('.graph-node')).toHaveCount(244);
  const geometry = await canvas.evaluate((svg) => {
    const bounds = svg.getBoundingClientRect();
    const viewport = svg.querySelector('.graph-viewport')!;
    const matrix = (viewport as SVGGElement).transform.baseVal.consolidate()!.matrix;
    const positions = [...svg.querySelectorAll<SVGGElement>('.graph-node')].map((node) => {
      const point = node.transform.baseVal.consolidate()!.matrix;
      const center = new DOMPoint(point.e, point.f).matrixTransform(matrix);
      return { x: point.e, y: point.f, screenX: center.x, screenY: center.y };
    });
    return { width: bounds.width, height: bounds.height, top: bounds.top, bottom: bounds.bottom, viewportHeight: innerHeight, scale: matrix.a, positions };
  });
  expect(geometry.top).toBeLessThan(geometry.viewportHeight * 0.4);
  expect(geometry.height).toBeGreaterThan(250);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.scale).toBeGreaterThan(0.1);
  expect(geometry.scale).toBeLessThanOrEqual(1);
  for (const node of geometry.positions) {
    expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true);
    expect(Math.abs(node.x)).toBeLessThan(3000);
    expect(Math.abs(node.y)).toBeLessThan(3000);
    expect(node.screenX).toBeGreaterThan(0);
    expect(node.screenX).toBeLessThan(geometry.width);
    expect(node.screenY).toBeGreaterThan(0);
    expect(node.screenY).toBeLessThan(geometry.height);
  }
  await expect(page.getByRole('table', { name: 'Topology relationships and radio evidence' })).toBeHidden();
  await expect(canvas.locator('.graph-link').first()).toHaveAttribute('d', /^M.*Q/);
  await page.screenshot({ path: testInfo.outputPath('organic-graph.png') });
});

test('zoom, pan buttons, keyboard and reset control the same viewport', async ({ page }) => {
  await mockApi(page, { graph: denseGraph(24) });
  await page.goto('/graph');
  const canvas = page.locator('.graph-workspace .graph-canvas');
  await expect(canvas.locator('.graph-node')).toHaveCount(28);
  const viewport = canvas.locator('.graph-viewport');
  const scale = () => viewport.evaluate((group: SVGGElement) => group.transform.baseVal.consolidate()!.matrix.a);
  const before = await scale();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  expect(await scale()).toBeCloseTo(before * 1.25, 5);
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  expect(await scale()).toBeCloseTo(before, 5);
  const transform = await viewport.getAttribute('transform');
  await page.getByRole('button', { name: 'Pan right', exact: true }).click();
  await expect(viewport).not.toHaveAttribute('transform', transform!);
  await canvas.focus();
  const panned = await viewport.getAttribute('transform');
  await page.keyboard.press('ArrowUp');
  await expect(viewport).not.toHaveAttribute('transform', panned!);
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  expect(await scale()).toBeLessThanOrEqual(1);
  const results = await new AxeBuilder({ page }).include('.graph-workspace').analyze();
  expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([]);
});

test('a resized canvas refits and keeps the controls reachable', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop resize exercises the shared ResizeObserver.');
  await mockApi(page, { graph: denseGraph(80) });
  await page.goto('/graph');
  const canvas = page.locator('.graph-workspace .graph-canvas');
  await expect(canvas.locator('.graph-node')).toHaveCount(84);
  const viewport = canvas.locator('.graph-viewport');
  const previous = await viewport.getAttribute('transform');
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(viewport).not.toHaveAttribute('transform', previous!);
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeVisible();
  expect(await canvas.evaluate((svg) => svg.getBoundingClientRect().width)).toBeLessThanOrEqual(768);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
});

test('hundreds of disconnected nodes do not generate extreme coordinates', async ({ page }) => {
  const graph = denseGraph(500);
  graph.nodes = graph.nodes.filter((node) => node.kind === 'device');
  graph.edges = [];
  graph.node_count = graph.nodes.length;
  graph.edge_count = 0;
  await mockApi(page, { graph });
  await page.goto('/graph');
  const nodes = page.locator('.graph-workspace .graph-node');
  await expect(nodes).toHaveCount(500);
  const positions = await nodes.evaluateAll((items: SVGGElement[]) => items.map((node) => {
    const point = node.transform.baseVal.consolidate()!.matrix;
    return [point.e, point.f];
  }));
  for (const [x, y] of positions) {
    expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    expect(Math.abs(x!)).toBeLessThan(3000);
    expect(Math.abs(y!)).toBeLessThan(3000);
  }
});

test('resize preserves an explored view and refresh restores automatic fitting', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop resize exercises the shared ResizeObserver.');
  let requests = 0;
  await mockApi(page, { graph: denseGraph(24), onGraphRequest: () => { requests += 1; } });
  await page.goto('/graph');
  const canvas = page.locator('.graph-workspace .graph-canvas');
  const viewport = canvas.locator('.graph-viewport');
  await expect(canvas.locator('.graph-node')).toHaveCount(28);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Pan right', exact: true }).click();
  const explored = await viewport.getAttribute('transform');
  await page.setViewportSize({ width: 768, height: 900 });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(viewport).toHaveAttribute('transform', explored!);

  const oldViewport = await viewport.elementHandle();
  const previousRequests = requests;
  await page.getByRole('button', { name: 'Refresh graph', exact: true }).click();
  await expect.poll(() => requests).toBeGreaterThan(previousRequests);
  await expect.poll(() => oldViewport?.evaluate((element) => element.isConnected)).toBe(false);
  await expect(canvas.locator('.graph-node')).toHaveCount(28);
  const refreshed = await viewport.getAttribute('transform');
  await page.setViewportSize({ width: 1024, height: 720 });
  await expect(viewport).not.toHaveAttribute('transform', refreshed!);
});
