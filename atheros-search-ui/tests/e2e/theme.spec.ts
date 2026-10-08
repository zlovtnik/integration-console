import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

const routes = [
  ['search', '/?q=probe_request'],
  ['network-report', '/graph'],
  ['inventory-report', '/inventory'],
  ['inventory-graph', '/inventory?view=graph&limit=100'],
  ['identity-review', '/inventory?view=dedup_queue&limit=100'],
  ['explain', '/explain/event%3Alab%3A001?kind=SEARCH_KIND_EVENT&q=probe_request'],
  ['not-found', '/missing-page'],
  ['callback', '/callback'],
] as const;

for (const width of [320, 768, 1440]) {
  test(`dark routes remain readable at ${width}px with saved light and system light`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.addInitScript(() => localStorage.setItem('theme', 'light'));
    await mockApi(page);
    for (const [name, route] of routes) {
      await page.goto(route);
      await expect(page.locator('#main-content')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(9, 9, 9)');
      await expect(page.getByRole('button', { name: /switch to .*theme/i })).toHaveCount(0);
      await page.addStyleTag({ content: `
        * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
        p { margin-bottom: 2em !important; }
      ` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name).toBe(true);
      const scan = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(scan.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })), name).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`), fullPage: true });
    }
  });
}

test('shared text, status, control and focus tokens meet contrast targets', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  const colors = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries([
      'bg', 'surface', 'surface-2', 'text-primary', 'text-secondary',
      'text-tertiary', 'accent', 'accent-strong', 'accent-ink', 'info',
      'warn', 'warn-bg', 'danger', 'danger-bg', 'ok', 'ok-bg', 'border', 'border-focus',
    ].map(name => [name, style.getPropertyValue(`--color-${name}`).trim()]));
  });
  const luminance = (hex: string) => {
    const rgb = hex.slice(1).match(/../g)!.map(value => {
      const channel = parseInt(value, 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
  };
  const contrast = (fg: string, bg: string) => {
    const values = [luminance(colors[fg]!), luminance(colors[bg]!)].sort((a, b) => b - a);
    return (values[0]! + 0.05) / (values[1]! + 0.05);
  };
  for (const background of ['bg', 'surface', 'surface-2']) {
    for (const text of ['text-primary', 'text-secondary', 'text-tertiary', 'accent', 'info', 'warn', 'danger', 'ok']) {
      expect(contrast(text, background), `${text} on ${background}`).toBeGreaterThanOrEqual(7);
    }
    for (const control of ['border', 'border-focus']) {
      expect(contrast(control, background), `${control} on ${background}`).toBeGreaterThanOrEqual(3);
    }
  }
  for (const status of ['warn', 'danger', 'ok']) expect(contrast(status, `${status}-bg`)).toBeGreaterThanOrEqual(7);
  for (const accent of ['accent', 'accent-strong']) expect(contrast('accent-ink', accent)).toBeGreaterThanOrEqual(7);
  const search = page.getByRole('button', { name: 'Search', exact: true });
  await search.focus();
  await expect(search).toHaveCSS('outline-width', '2px');
  await expect(search).toHaveCSS('outline-color', 'rgb(163, 230, 163)');
  const smallControls = await page.locator('button:visible, .nav-link:visible, .seg-option span:visible, summary:visible').evaluateAll(elements => elements.filter(element => {
    const rect = element.getBoundingClientRect();
    return rect.width < 44 || rect.height < 44;
  }).map(element => ({ text: element.textContent, label: element.getAttribute('aria-label') })));
  expect(smallControls).toEqual([]);
});

test('system storage, forced colors and reduced motion preserve keyboard use', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'system'));
  await page.emulateMedia({ colorScheme: 'light', forcedColors: 'active', reducedMotion: 'reduce' });
  await mockApi(page);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const search = page.getByRole('combobox', { name: 'Search wireless events' });
  await search.focus();
  await search.fill('probe_request');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'event:lab:001' })).toBeVisible();
  await expect(page.locator('.result-card').first()).toHaveCSS('animation-duration', '1e-05s');
  await page.goto('/inventory?view=graph&limit=100');
  const node = page.locator('.inventory-node').first();
  await node.focus();
  await page.keyboard.press('Enter');
  await expect(node).toHaveClass(/selected/);
  await expect(node.locator('.graph-node-ring')).toHaveCSS('stroke-opacity', '1');
});
