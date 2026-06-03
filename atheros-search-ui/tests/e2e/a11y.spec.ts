import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('search page has no critical accessibility violations', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blockingViolations = results.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact ?? ''),
  );
  const summary = blockingViolations
    .map((violation) => `${violation.id}: ${violation.help}`)
    .join('\n');

  expect(blockingViolations, summary).toHaveLength(0);
});

test('keyboard path covers skip link, search, and filter drawer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto('/');

  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await skipLink.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();

  await page.keyboard.press('Control+Shift+F');
  const drawer = page.getByRole('dialog', { name: 'Filters' });
  const closeButton = page.getByRole('button', { name: 'Close filters' });
  await expect(drawer).toBeVisible();
  await expect(closeButton).toBeFocused();
  expect(
    await page.evaluate(() =>
      document.body.classList.contains('filter-drawer-open'),
    ),
  ).toBe(true);

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('button', { name: 'Filters' })).toBeFocused();
  expect(
    await page.evaluate(() =>
      document.body.classList.contains('filter-drawer-open'),
    ),
  ).toBe(false);

  await page
    .getByRole('combobox', { name: 'Search wireless events' })
    .fill('probe_request');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'event:lab:001' })).toBeVisible();

  await page.getByRole('button', { name: 'Clear search' }).click();
  await page
    .getByRole('combobox', { name: 'Search wireless events' })
    .fill('probe');
  await page.waitForSelector('#suggestion-0');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#search-input')).toHaveAttribute(
    'aria-activedescendant',
    'suggestion-0',
  );
});
