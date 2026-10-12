import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('evidence disclosure is keyboard accessible below the graph', async ({ page }) => {
  await mockApi(page);
  await page.goto('/graph');
  const summary = page.getByText('Wireless observation evidence', { exact: true });
  const table = page.getByRole('table', { name: 'Topology relationships and radio evidence' });
  await expect(table).toBeHidden();
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(table).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(table).toBeHidden();
});
