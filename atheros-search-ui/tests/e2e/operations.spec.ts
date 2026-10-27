import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

for (const width of [375, 768, 1024, 1440]) {
  test(`pipeline workbench stays accessible at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockApi(page);
    for (const path of [
      '/ingestion',
      '/sources',
      '/sources/proxy',
      '/evidence',
    ]) {
      await page.goto(path);
      await expect(page.locator('#main-content h1')).toBeVisible();
      const navigation = page.getByRole('navigation', {
        name: 'Primary navigation',
      });
      await expect(navigation.getByRole('link')).toHaveText([
        'Retrieval Search',
        'Ingestion',
        'Sources',
        'Evidence',
        'Graph',
        'Inventory',
        'Processing DQ',
      ]);
      if (width >= 1280) {
        for (const link of await navigation.getByRole('link').all()) {
          await expect(link).toBeInViewport();
        }
      }
      await expect(
        page.getByRole('region', { name: 'Global pipeline status' }),
      ).toContainText('current');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      const accessibility = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        accessibility.violations.filter((value) =>
          ['serious', 'critical'].includes(value.impact ?? ''),
        ),
      ).toEqual([]);
    }
    await page.getByRole('link', { name: 'Skip to main content' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
  });
}

test('sources distinguish missing coverage, zero vectors and live telemetry', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/sources');
  const wireless = page.getByRole('row', { name: /Wireless observations/ });
  await expect(wireless).toContainText('Unknown');
  const proxy = page.getByRole('row', { name: /Proxy observations/ });
  await expect(proxy).toContainText('stale');
  await expect(proxy).toContainText('missing');
  await proxy.getByRole('link').click();
  await expect(
    page.getByRole('heading', { name: 'Indexed evidence' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Live aggregate telemetry' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Load live telemetry' }).click();
  await expect(
    page.getByText(
      'Rates unavailable on first sample, counter reset or process change.',
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('definition').filter({ hasText: /^2$/ }),
  ).toBeVisible();
});

test('live viewer denial leaves indexed evidence and retrieval available', async ({
  page,
}) => {
  await mockApi(page);
  await page.route('**/v1/operations/proxy/live', (route) =>
    route.fulfill({ status: 403, body: '{}' }),
  );
  await page.goto('/sources/proxy');
  await page.getByRole('button', { name: 'Load live telemetry' }).click();
  await expect(
    page.getByText(/Indexed evidence remains available/),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Retrieval', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Search wireless and proxy records' }),
  ).toBeVisible();
});
