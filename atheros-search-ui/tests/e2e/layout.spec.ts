import { expect, type Locator, type Page, test } from '@playwright/test';
import { mockApi, mockResult } from './fixtures';

const viewports = [
  { name: 'narrow', width: 360, height: 800 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'compact-desktop', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

const longResult = {
  ...mockResult,
  source_key: `event:lab:${'001-'.repeat(24)}probe-request`,
  ssid: `lab-network-${'secure-'.repeat(12)}iot`,
  tags: [
    'threat:shadow',
    `location:${'north-wing-'.repeat(10)}`,
    `sensor:${'cluster-alpha-'.repeat(8)}`,
  ],
  detail_json: JSON.stringify({
    subtype: 'probe_request',
    channel: 11,
    source: 'aa:bb:cc:dd:ee:ff',
    path: `wireless/${'nested-segment/'.repeat(20)}event.json`,
  }),
};

async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));

  expect(metrics.documentScrollWidth).toBeLessThanOrEqual(
    metrics.innerWidth + 1,
  );
  expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
}

async function expectWithinViewport(
  page: Page,
  locator: Locator,
  label: string,
) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();

  expect(box, `${label} should have a layout box`).not.toBeNull();
  expect(viewport, 'viewport should be available').not.toBeNull();
  if (!box || !viewport) return;

  expect(box.x, `${label} should not overflow left`).toBeGreaterThanOrEqual(0);
  expect(
    box.x + box.width,
    `${label} should not overflow right`,
  ).toBeLessThanOrEqual(viewport.width + 1);
}

async function expectSettledWithinViewport(
  page: Page,
  locator: Locator,
  label: string,
) {
  await expect
    .poll(async () => {
      const box = await locator.boundingBox();
      return box?.x ?? -1;
    }, `${label} should finish sliding into view`)
    .toBeGreaterThanOrEqual(0);
  await expectWithinViewport(page, locator, label);
}

for (const viewport of viewports) {
  test(`search layout stays bounded at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await mockApi(page, { results: [longResult] });
    await page.goto('/');

    await page
      .getByRole('combobox', { name: 'Search wireless events' })
      .fill('probe_request');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('heading', { name: /event:lab:/ })).toBeVisible();
    await page.getByRole('button', { name: 'Show detail' }).click();
    await expect(page.getByText(/nested-segment/)).toBeVisible();

    await expectNoHorizontalOverflow(page);
    await expectWithinViewport(
      page,
      page.getByRole('navigation', { name: 'Primary navigation' }),
      'top navigation',
    );
    await expectWithinViewport(
      page,
      page.getByRole('combobox', { name: 'Search wireless events' }),
      'search input',
    );
    await expectWithinViewport(
      page,
      page.getByRole('article').first(),
      'result card',
    );

    if (viewport.width < 1120) {
      const filterButton = page.getByRole('button', { name: 'Filters' });
      await expect(filterButton).toBeVisible();
      await filterButton.click();
      const drawer = page.getByRole('dialog', { name: 'Filters' });
      await expect(drawer).toBeVisible();
      await expectSettledWithinViewport(page, drawer, 'filter drawer');
      await expectNoHorizontalOverflow(page);
    } else {
      await expect(page.getByRole('button', { name: 'Filters' })).toBeHidden();
      await expect(
        page.getByRole('complementary', { name: 'Filters' }),
      ).toBeVisible();
    }
  });
}
