import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('hit test summary', async ({ page }) => {
  await mockApi(page);
  await page.goto('/graph');
  await page.waitForTimeout(1000);
  const summary = page.getByText('Advanced projection explorer', { exact: true });
  console.log('count', await summary.count());
  console.log('tag', await summary.evaluate(el => el.tagName + ' ' + el.className));
  const box = await summary.boundingBox();
  console.log('box', box);
  // try click
  try {
    await summary.click({ timeout: 3000 });
    console.log('click OK');
  } catch (e) {
    console.log('click FAIL', String(e).slice(0, 500));
  }
  // try force click
  try {
    await summary.click({ force: true, timeout: 3000 });
    console.log('force click OK');
  } catch (e) {
    console.log('force FAIL', String(e).slice(0, 300));
  }
  // open via keyboard
  await summary.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  console.log('details open', await page.locator('details.report-controls').evaluate((d: HTMLDetailsElement) => d.open));
  expect(true).toBe(true);
});
