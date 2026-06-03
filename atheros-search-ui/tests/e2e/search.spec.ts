import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('submits a streaming search and renders an expandable result', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Search wireless events' }).fill('probe_request');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'event:lab:001' })).toBeVisible();
  await expect(page.getByRole('meter', { name: 'Score 91.0%' })).toBeVisible();

  await page.getByRole('button', { name: 'Show detail' }).click();
  await expect(page.getByText('"channel": 11')).toBeVisible();
});

test('applies and removes active filter chips', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Source MAC').fill('aa:bb:cc:dd:ee:ff');
  await expect(page.getByRole('button', { name: 'Remove filter: aa:bb:cc:dd:ee:ff' })).toBeVisible();

  await page.getByRole('button', { name: 'Remove filter: aa:bb:cc:dd:ee:ff' }).click();
  await expect(page.getByRole('button', { name: 'Remove filter: aa:bb:cc:dd:ee:ff' })).toHaveCount(0);
});

test('opens explain page from a result', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Search wireless events' }).fill('probe_request');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('link', { name: 'Explain' }).click();

  await expect(page.getByRole('heading', { name: /Explain: event:lab:001/ })).toBeVisible();
  await expect(page.getByText('shadow alert')).toBeVisible();
});
