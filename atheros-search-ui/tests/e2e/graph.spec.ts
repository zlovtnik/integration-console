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
