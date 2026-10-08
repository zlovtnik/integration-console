import { expect, test, type Page } from '@playwright/test';
import type { EdgeKind, GraphHierarchy, GraphResponse } from '~/api/types';
import { mockApi } from './fixtures';

function fanoutGraph(childCount: number, options?: { truncated?: boolean }): GraphResponse {
  const children = Array.from({ length: childCount }, (_, index) => ({
    id: `device:${String(index).padStart(4, '0')}`,
    kind: 'device' as const,
    label: `Device ${index}`,
    parent_id: 'ap:root',
    depth: 1,
  }));
  const hierarchy: GraphHierarchy = {
    root_id: 'ap:root',
    root_ids: ['ap:root'],
    truncated: Boolean(options?.truncated),
  };
  if (options?.truncated) {
    hierarchy.reason =
      'Node limit 1000 reached; showing 21 of 400 nodes in the root neighborhood.';
  }
  return {
    generated_at: '2026-10-08T12:00:00Z',
    node_count: childCount + 2,
    edge_count: childCount + 2,
    hierarchy,
    nodes: [
      { id: 'ap:root', kind: 'ap', label: 'Main AP', depth: 0 },
      ...children,
      { id: 'device:orphan', kind: 'device', label: 'Unattached printer' },
    ],
    edges: [
      ...children.map((node) => ({
        id: `tree:${node.id}`,
        source: node.id,
        target: 'ap:root',
        kind: 'association' as EdgeKind,
        tree_role: 'tree' as const,
      })),
      {
        id: 'secondary:rf',
        source: children[0]!.id,
        target: children[1]?.id ?? children[0]!.id,
        kind: 'rf_proximity' as EdgeKind,
        tree_role: 'secondary' as const,
      },
      {
        id: 'secondary:shadow',
        source: 'ap:root',
        target: 'device:orphan',
        kind: 'shadow' as EdgeKind,
        tree_role: 'secondary' as const,
      },
    ],
  };
}

async function openHierarchy(page: Page, graph: GraphResponse) {
  await mockApi(page, { graph });
  await page.goto('/graph?g_layout=hierarchy');
  await page.getByText('Advanced projection explorer', { exact: true }).click();
  await page.getByRole('button', { name: 'Open projection explorer' }).click();
  await expect(page.locator('svg.graph-canvas')).toHaveAttribute(
    'data-layout',
    'hierarchy',
  );
}

test('hierarchy view roots at the Main AP and branches children deeper', async ({
  page,
}) => {
  await openHierarchy(page, fanoutGraph(20));
  await expect(page.locator('.graph-node')).toHaveCount(22);
  const root = page.locator('.graph-node[data-node-id="ap:root"]');
  await expect(root).toHaveAttribute('data-depth', '0');
  const rootBox = (await root.boundingBox())!;
  const childNodes = await page.locator('.graph-node[data-depth="1"]').all();
  for (const child of childNodes) {
    const box = (await child.boundingBox())!;
    // Depth bands advance along +x from the Main AP root.
    expect(box.x).toBeGreaterThan(rootBox.x);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(box.x)).toBe(true);
    expect(Number.isFinite(box.y)).toBe(true);
  }
  // Layout-space positions stay unique after tree.nodeSize spacing.
  const transforms = await Promise.all(
    childNodes.map((node) => node.getAttribute('transform')),
  );
  expect(new Set(transforms).size).toBe(childNodes.length);
  const rootTransform = await root.getAttribute('transform');
  expect(new Set([rootTransform, ...transforms]).size).toBe(childNodes.length + 1);
});

test('secondary relationships render without becoming tree links', async ({
  page,
}) => {
  await openHierarchy(page, fanoutGraph(20));
  await page.getByLabel('Secondary relationships').check();
  await expect(
    page.locator('.graph-link[data-tree-role="tree"]'),
  ).toHaveCount(20);
  await expect(
    page.locator('.graph-link[data-tree-role="secondary"]'),
  ).toHaveCount(2);
  await expect(
    page.locator('.graph-link[data-tree-role="secondary"][data-edge-kind="rf_proximity"]'),
  ).toHaveCount(1);
});

test('orphan nodes appear under the Unattached group', async ({ page }) => {
  await openHierarchy(page, fanoutGraph(20));
  await expect(page.locator('.graph-hierarchy-group')).toHaveText('Unattached');
  await expect(
    page.locator('.graph-node[data-node-id="device:orphan"]'),
  ).toHaveCount(1);
});

test('truncated hierarchy surfaces a partial-graph banner', async ({ page }) => {
  await openHierarchy(page, fanoutGraph(20, { truncated: true }));
  const banner = page.locator('.graph-coverage-warning', {
    hasText: 'Partial graph:',
  });
  await expect(banner).toContainText('Node limit 1000 reached');
});

test('large fan-out keeps nodes off the origin and inside the canvas', async ({
  page,
}) => {
  await openHierarchy(page, fanoutGraph(200));
  await expect(page.locator('.graph-node')).toHaveCount(202);
  const nodes = await page.locator('.graph-node').all();
  const transforms = await Promise.all(
    nodes.map((node) => node.getAttribute('transform')),
  );
  // Distinct layout coordinates — fit may zoom out but must not stack nodes.
  expect(new Set(transforms).size).toBe(202);
  const boxes = await Promise.all(nodes.map((node) => node.boundingBox()));
  for (const box of boxes) {
    expect(Number.isFinite(box!.x)).toBe(true);
    expect(Number.isFinite(box!.y)).toBe(true);
    // No (0,0) pile: every node sits inside the fitted viewport.
    expect(box!.x).toBeGreaterThan(-40);
    expect(box!.y).toBeGreaterThan(-40);
    expect(box!.x).toBeLessThan(4000);
    expect(box!.y).toBeLessThan(4000);
  }
});
