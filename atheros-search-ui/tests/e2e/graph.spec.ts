import { expect, test } from '@playwright/test';
import type { SearchRequest } from '~/api/types';
import { mockApi } from './fixtures';

test('graph filters auto-refresh topology requests', async ({ page }) => {
  const graphRequests: unknown[] = [];
  await mockApi(page, {
    onGraphRequest: (body) => graphRequests.push(body),
  });

  await page.goto('/graph');
  await expect(page.locator('.graph-node[data-kind="cluster"]')).toBeVisible();

  await page.getByLabel('Source MAC').fill('aa:bb:cc:dd:ee:ff');

  await expect
    .poll(() =>
      graphRequests.some(
        (body) =>
          typeof body === 'object' &&
          body !== null &&
          (body as { source_mac?: string }).source_mac === 'aa:bb:cc:dd:ee:ff',
      ),
    )
    .toBe(true);
});

test('graph paints nodes without NaN transforms on first load', async ({
  page,
}) => {
  await mockApi(page);

  await page.goto('/graph');

  await expect(page.locator('.graph-node').first()).toBeVisible();
  await page.waitForTimeout(2_000);

  const transformValues = await page
    .locator('svg [transform]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('transform') ?? ''),
    );

  expect(transformValues.join(' ')).not.toContain('NaN');
});

test('cluster search events action requests a sparse 200-event entity timeline', async ({
  page,
}) => {
  const searchRequests: SearchRequest[] = [];
  await mockApi(page, {
    onSearchRequest: (body) => searchRequests.push(body),
  });

  await page.goto('/graph');
  await page.locator('.graph-node[data-kind="cluster"]').click({ force: true });
  await page.getByRole('link', { name: 'Search events' }).click();

  await expect
    .poll(() =>
      searchRequests.some((request) => {
        const macs = request.filters?.source_macs ?? [];
        return (
          request.query === '*' &&
          request.kind === 'SEARCH_KIND_EVENT' &&
          request.mode === 'SEARCH_MODE_SPARSE' &&
          request.top_k === 200 &&
          macs.includes('aa:bb:cc:dd:ee:ff') &&
          macs.includes('11:22:33:44:55:66')
        );
      }),
    )
    .toBe(true);
});

test('cluster search events preserves the active graph SSID scope', async ({
  page,
}) => {
  const searchRequests: SearchRequest[] = [];
  const graphRequests: unknown[] = [];
  await mockApi(page, {
    onGraphRequest: (body) => graphRequests.push(body),
    onSearchRequest: (body) => searchRequests.push(body),
  });

  await page.goto('/graph');
  await page.getByLabel('SSID').fill('lab-net');
  await expect
    .poll(() =>
      graphRequests.some(
        (body) =>
          typeof body === 'object' &&
          body !== null &&
          (body as { ssid?: string }).ssid === 'lab-net',
      ),
    )
    .toBe(true);
  await expect(page.locator('.graph-node[data-kind="cluster"]')).toBeVisible();
  await page.locator('.graph-node[data-kind="cluster"]').click({ force: true });
  await page.getByRole('link', { name: 'Search events' }).click();

  await expect
    .poll(() =>
      searchRequests.some((request) => {
        const macs = request.filters?.source_macs ?? [];
        return (
          request.filters?.ssid === 'lab-net' &&
          macs.includes('aa:bb:cc:dd:ee:ff') &&
          macs.includes('11:22:33:44:55:66')
        );
      }),
    )
    .toBe(true);
});
