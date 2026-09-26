import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('screenshots', async ({ page }) => {
  await mockApi(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/graph');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: '/tmp/shot-graph-desktop.png' });

  // open edges dropdown
  await page.getByRole('button', { name: /Edges/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/shot-graph-edges.png' });
  await page.keyboard.press('Escape');

  // open views dropdown
  await page.getByRole('button', { name: /Views/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/shot-graph-views.png' });
  await page.keyboard.press('Escape');

  // node selected
  await page.locator('.graph-node[data-kind="cluster"]').click({ force: true });
  await page.waitForTimeout(600);
  await page.screenshot({ path: '/tmp/shot-graph-selected.png' });

  await page.setViewportSize({ width: 393, height: 727 });
  await page.goto('/graph');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: '/tmp/shot-graph-mobile.png', fullPage: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/inventory');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: '/tmp/shot-inventory-desktop.png' });

  await page.goto('/');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/shot-search-desktop.png' });

  expect(true).toBe(true);
});
