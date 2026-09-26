import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('debug inventory layout', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/inventory');
  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>(
      'form.graph-controls',
    );
    if (!form) return { found: false };
    const cs = getComputedStyle(form);
    const children = Array.from(form.children).map((child) => {
      const rect = child.getBoundingClientRect();
      return {
        cls: child.getAttribute('class'),
        tag: child.tagName,
        x: rect.x,
        y: rect.y,
        w: rect.width,
        h: rect.height,
        colStart: getComputedStyle(child).gridColumnStart,
      };
    });
    return {
      found: true,
      display: cs.display,
      template: cs.gridTemplateColumns,
      gap: cs.gap,
      children,
      formClass: form.className,
      sheetOk: Array.from(document.styleSheets).map((sheet) => {
        try {
          return { href: sheet.href, rules: sheet.cssRules.length };
        } catch {
          return { href: sheet.href, rules: -1 };
        }
      }),
    };
  });
  console.log(JSON.stringify(info, null, 2));
  expect(info.found).toBe(true);
});
