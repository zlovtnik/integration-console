import { expect, test } from '@playwright/test';
import { mockApi, mockInventorySimilarity } from './fixtures';

test('default graph shows ownership and presentation fills the window', async ({
  page,
}, testInfo) => {
  await mockApi(page);
  await page.goto('/inventory?view=graph');
  await expect(
    page.getByRole('combobox', { name: 'Graph relationships' }),
  ).toHaveValue('cmdb');
  await expect(
    page.locator('.inventory-link[data-edge-kind="owns"]'),
  ).not.toHaveCount(0);
  await page.getByRole('button', { name: 'Presentation view' }).click();
  await expect(
    page.getByRole('searchbox', { name: 'Identifier or name' }),
  ).toBeHidden();
  await expect(page.locator('.inventory-page')).toHaveClass(
    /inventory-page--presenting/,
  );
  await expect
    .poll(
      async () => (await page.locator('.graph-canvas').boundingBox())?.height,
    )
    .toBe(page.viewportSize()!.height);
  await page.screenshot({ path: testInfo.outputPath('presentation.png') });
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('searchbox', { name: 'Identifier or name' }),
  ).toBeVisible();
});

test('bulk review previews pairs and records the selected approvals', async ({
  page,
}, testInfo) => {
  await mockApi(page, { inventory: () => mockInventorySimilarity });
  const decisions: string[] = [];
  await page.route(
    '**/v1/inventory/merge-candidates/*/decision',
    async (route) => {
      const candidate = route.request().url().split('/').at(-2)!;
      decisions.push(candidate);
      await route.fulfill({
        json: { candidate_id: candidate, decision: 'merge', accepted: true },
      });
    },
  );
  await page.goto('/inventory?view=dedup_queue');
  await expect(
    page.getByRole('checkbox', { name: 'Select all visible pairs' }),
  ).toBeEnabled();
  await page
    .getByRole('checkbox', { name: 'Select all visible pairs' })
    .check();
  await page.getByRole('button', { name: 'Review selected approvals' }).click();
  expect(decisions).toEqual([]);
  await expect(
    page.getByRole('region', { name: 'Selected approval preview' }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('bulk-preview.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Approve selected pairs' }).click();
  await expect(page.locator('.dedup-queue p[role="status"]')).toContainText(
    '1 approved, 0 failed',
  );
  expect(decisions).toEqual(['pair-1']);
});

test('large filtered similarity graphs keep their pair relationships', async ({
  page,
}) => {
  const nodes = Array.from({ length: 401 }, (_, index) => ({
    id: `device:${index}`,
    kind: 'device' as const,
    label: `Device ${index}`,
    active: true,
  }));
  const pair = {
    id: 'pair',
    source: nodes[0]!.id,
    target: nodes[1]!.id,
    kind: 'candidate_pair' as const,
  };
  await mockApi(page, {
    inventory: () => ({
      nodes,
      edges: [pair],
      node_count: 401,
      edge_count: 1,
      generated_at: '2026-10-04T12:00:00Z',
    }),
  });
  await page.goto('/inventory?view=graph&grouping=similarity&owner=security');
  await expect(
    page.locator('.inventory-link[data-edge-kind="candidate_pair"]'),
  ).toHaveCount(1);
  await expect(page.locator('.inventory-node[data-kind="device"]')).toHaveCount(
    2,
  );
  await expect(
    page.locator('.inventory-node[data-kind="aggregate_group"]'),
  ).toHaveCount(1);
  await expect(
    page.locator(
      '.inventory-node[data-kind="aggregate_group"] .graph-node-body',
    ),
  ).toHaveAttribute('r', '20');
});
