import { expect, test } from '@playwright/test';
import type { SearchRequest, SearchResult } from '~/api/types';
import { mockApi, mockResult } from './fixtures';

async function openFiltersIfDrawer(page: Parameters<typeof mockApi>[0]) {
  const filtersButton = page.getByRole('button', { name: 'Filters' });
  if (await filtersButton.isVisible()) await filtersButton.click();
}

async function closeFiltersIfDrawer(page: Parameters<typeof mockApi>[0]) {
  const drawer = page.getByRole('dialog', { name: 'Filters' });
  if (await drawer.isVisible()) await page.keyboard.press('Escape');
}

test('submits a streaming search and renders an expandable result', async ({
  page,
}) => {
  await mockApi(page);

  await page.goto('/');
  await page
    .getByRole('combobox', { name: 'Search wireless events' })
    .fill('probe_request');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  await expect(
    page.getByRole('heading', { name: 'event:lab:001' }),
  ).toBeVisible();
  await expect(page.getByRole('meter', { name: 'Score 91.0%' })).toBeVisible();

  await page.getByRole('button', { name: 'Show detail' }).click();
  await expect(page.getByText('"channel": 11')).toBeVisible();
});

test('applies and removes active filter chips', async ({ page }) => {
  await mockApi(page);

  await page.goto('/');
  await openFiltersIfDrawer(page);
  await page.getByLabel('Source MAC').fill('aa:bb:cc:dd:ee:ff');
  await closeFiltersIfDrawer(page);
  await expect(
    page.getByRole('button', { name: 'Remove filter: aa:bb:cc:dd:ee:ff' }),
  ).toBeVisible();

  await page
    .getByRole('button', { name: 'Remove filter: aa:bb:cc:dd:ee:ff' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Remove filter: aa:bb:cc:dd:ee:ff' }),
  ).toHaveCount(0);
});

test('initial URL query submits one stream request and filter chip removal does not resubmit', async ({
  page,
}) => {
  const searchRequests: SearchRequest[] = [];
  await mockApi(page, {
    onSearchRequest: (request) => searchRequests.push(request),
  });

  await page.goto('/?q=probe_request&mac=aa:bb:cc:dd:ee:ff');

  await expect(
    page.getByRole('heading', { name: 'event:lab:001' }),
  ).toBeVisible();
  await expect.poll(() => searchRequests.length, { timeout: 1_000 }).toBe(1);

  await page
    .getByRole('button', { name: 'Remove filter: aa:bb:cc:dd:ee:ff' })
    .click();
  await page.waitForTimeout(300);

  expect(searchRequests).toHaveLength(1);
});

test('streaming renders the first result before the next chunk arrives', async ({
  page,
}) => {
  const secondResult: SearchResult = {
    ...mockResult,
    source_key: 'event:lab:002',
    score: 0.82,
  };

  await page.addInitScript(
    ({ firstResult, nextResult }) => {
      const originalFetch = window.fetch.bind(window);

      window.fetch = (input, init) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof Request
              ? input.url
              : String(input);

        if (!url.includes('/v1/search/stream')) {
          return originalFetch(input, init);
        }

        const encoder = new TextEncoder();
        const body = new ReadableStream({
          start(controller) {
            window.setTimeout(() => {
              controller.enqueue(
                encoder.encode(`${JSON.stringify(firstResult)}\n`),
              );
            }, 100);
            window.setTimeout(() => {
              controller.enqueue(
                encoder.encode(`${JSON.stringify(nextResult)}\n`),
              );
              controller.close();
            }, 900);
          },
        });

        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { 'Content-Type': 'application/x-ndjson' },
          }),
        );
      };
    },
    { firstResult: mockResult, nextResult: secondResult },
  );
  await mockApi(page, { results: [mockResult, secondResult] });

  await page.goto('/');
  await page
    .getByRole('combobox', { name: 'Search wireless events' })
    .fill('probe_request');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  await expect(
    page.getByRole('heading', { name: 'event:lab:001' }),
  ).toBeVisible({
    timeout: 600,
  });
  await expect(
    page.getByRole('heading', { name: 'event:lab:002' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'event:lab:002' }),
  ).toBeVisible({
    timeout: 1_500,
  });
});

test('opens explain page from a result', async ({ page }) => {
  await mockApi(page);

  await page.goto('/');
  await page
    .getByRole('combobox', { name: 'Search wireless events' })
    .fill('probe_request');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('link', { name: 'Explain' }).click();

  await expect(
    page.getByRole('heading', { name: /Explain: event:lab:001/ }),
  ).toBeVisible();
  await expect(page.getByText('shadow alert')).toBeVisible();
});
