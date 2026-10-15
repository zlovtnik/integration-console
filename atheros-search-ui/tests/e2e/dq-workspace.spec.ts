import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { mockApi, mockInventorySimilarity } from './fixtures';

const settings = {
  enabled: true,
  beta_enabled: true,
  approved_remote_origin: '',
  bridge_version: 1,
};
const manifest = {
  installation_id: 'test',
  namespace: 'audit',
  processor_id: 'atheros.dedup',
  version: '0.1.0',
  owner_team: 'test',
  implementation_digest: 'a'.repeat(64),
  policy_version: 'v1',
  parameter_schema: {
    type: 'object',
    properties: { authorized_scope: { type: 'string', default: '*' } },
    required: ['authorized_scope'],
  },
};
const run = {
  run_id: 'run-1',
  installation_id: 'test',
  namespace: 'audit',
  processor_id: 'atheros.dedup',
  processor_version: '0.1.0',
  operation: 'prepare_candidates',
  parameters: { authorized_scope: '*' },
  status: 'succeeded',
  state_revision: 2,
  execution_mode: 'enabled',
  projection_applied: false,
  input_refs: [],
  output_refs: [],
  created_at: '2026-10-15T10:00:00Z',
  deadline_at: '2026-10-15T10:05:00Z',
};

async function embeddedAssets(page: Page) {
  await page.route('**/dq-ui/**', async (route) => {
    const path = new URL(route.request().url()).pathname.slice(
      '/dq-ui/'.length,
    );
    if (path !== 'embedded.html' && !/^assets\/[\w-]+\.(js|css)$/.test(path)) {
      await route.abort();
      return;
    }
    const body = await readFile(
      resolve(process.cwd(), '../../../services/dq/ui/dist/embedded', path),
    );
    await route.fulfill({
      body,
      contentType: path.endsWith('.js')
        ? 'text/javascript'
        : path.endsWith('.css')
          ? 'text/css'
          : 'text/html',
    });
  });
}

test('DQ disabled and unavailable do not disrupt existing pages', async ({
  page,
}) => {
  await mockApi(page);
  await page.route('**/v1/dq/context', (route) =>
    route.fulfill({ json: { ...settings, enabled: false } }),
  );
  await page.goto('/');
  await page.getByRole('link', { name: 'DQ', exact: true }).click();
  await expect(page.getByText('DQ is disabled.')).toBeVisible();
  expect(page.frames()).toHaveLength(1);
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/\/($|\?)/);
  await page.route('**/v1/dq/context', (route) =>
    route.fulfill({ status: 503, json: { error: 'unavailable' } }),
  );
  await page.goto('/dq');
  await expect(
    page.getByRole('button', { name: 'Retry', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Inventory', exact: true }).click();
  await expect(
    page.getByRole('searchbox', { name: 'Identifier or name' }),
  ).toBeVisible();
});

test('independent shell supports invocation, status, direct links, history and session teardown', async ({
  page,
}) => {
  await mockApi(page);
  await embeddedAssets(page);
  await page.route('**/v1/dq/context', (route) =>
    route.fulfill({ json: settings }),
  );
  await page.route('**/v1/dq/processors', (route) =>
    route.fulfill({ json: { items: [manifest] } }),
  );
  await page.route('**/v1/dq/processor-versions/**', (route) =>
    route.fulfill({ json: manifest }),
  );
  let submissions = 0;
  let reads = 0;
  await page.route('**/v1/dq/runs', (route) => {
    submissions++;
    return route.fulfill({
      status: 202,
      json: { ...run, status: 'queued', state_revision: 1 },
    });
  });
  await page.route('**/v1/dq/runs/run-1', (route) => {
    reads++;
    return route.fulfill({
      json: {
        ...run,
        projection_applied: reads > 1,
        state_revision: reads + 1,
      },
    });
  });
  await page.goto('/dq/processors');
  const frame = page.frameLocator('iframe[title="DQ workspace"]');
  await expect(
    frame.getByRole('heading', { name: 'Processors', exact: true }),
  ).toBeVisible();
  expect(submissions).toBe(0);
  await expect(frame.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  await frame.getByRole('button', { name: 'Open invocation' }).click();
  await expect(page).toHaveURL(
    /\/dq\/processors\/atheros.dedup\/0.1.0\/invoke/,
  );
  await page.reload();
  await frame
    .getByRole('button', { name: 'Review invocation', exact: true })
    .click();
  expect(submissions).toBe(0);
  await frame.getByRole('button', { name: 'Submit run', exact: true }).click();
  await expect(page).toHaveURL(/\/dq\/runs\/run-1/);
  await expect(
    frame.getByText('Run completed. Projection application is not confirmed.'),
  ).toBeVisible();
  await expect(
    frame.getByText('Run completed. Projection applied.'),
  ).toBeVisible({ timeout: 8000 });
  expect(submissions).toBe(1);
  await page.goBack();
  await expect(
    frame.getByRole('button', { name: 'Review invocation', exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(frame.getByRole('heading', { name: 'Run run-1' })).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'atheros-search.audit-identity',
        newValue: 'different-user',
      }),
    ),
  );
  await expect(page.locator('iframe[title="DQ workspace"]')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Sign in', exact: true }),
  ).toBeVisible();
});

test('workspace reuses review decisions, preserves filters and refreshes on return', async ({
  page,
}) => {
  let candidateReads = 0;
  await mockApi(page, {
    inventory: () => {
      candidateReads++;
      return mockInventorySimilarity;
    },
  });
  await embeddedAssets(page);
  await page.route('**/v1/dq/context', (route) =>
    route.fulfill({ json: settings }),
  );
  await page.route('**/v1/dq/processors', (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  const decisions: string[] = [];
  await page.route('**/v1/inventory/merge-candidates/*/decision', (route) => {
    decisions.push(route.request().postDataJSON().decision);
    return route.fulfill({
      json: { candidate_id: 'pair-1', decision: 'merge', accepted: true },
    });
  });
  await page.goto('/inventory?view=dedup_queue&loc=lab');
  await expect(page).toHaveURL(/\/dq\?/);
  await expect(
    page.getByRole('textbox', { name: 'Location', exact: true }),
  ).toHaveValue('lab');
  await page
    .getByRole('checkbox', { name: 'Select all visible pairs' })
    .check();
  await page.getByRole('button', { name: 'Review selected approvals' }).click();
  expect(decisions).toHaveLength(0);
  await page.getByRole('button', { name: 'Approve selected pairs' }).click();
  await expect.poll(() => decisions.length).toBe(1);
  const before = candidateReads;
  await page.getByRole('link', { name: 'Processors', exact: true }).click();
  await expect(
    page
      .frameLocator('iframe')
      .getByRole('heading', { name: 'Processors', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Review candidates', exact: true })
    .click();
  await expect.poll(() => candidateReads).toBeGreaterThan(before);
  const refreshed = candidateReads;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => candidateReads).toBeGreaterThan(refreshed);
  await page.route('**/v1/inventory/merge-candidates/pair-1', (route) =>
    route.fulfill({
      json: {
        candidate_id: 'pair-1',
        mac_a: 'aa:bb:cc:dd:ee:ff',
        mac_b: '11:22:33:44:55:66',
        confidence: 0.91,
        status: 'pending',
        evidence: { method: 'fingerprint' },
        devices: mockInventorySimilarity.nodes.filter(
          (node) => node.kind === 'device',
        ),
      },
    }),
  );
  await page
    .getByRole('button', {
      name: 'aa:bb:cc:dd:ee:ff / 11:22:33:44:55:66',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Lab identifier', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Needs more data', exact: true })
    .click();
  await expect.poll(() => decisions).toEqual(['merge', 'needs_more_data']);
});

test('shell failure has retry and artifact deep links authorize access explicitly', async ({
  page,
}) => {
  await mockApi(page);
  await embeddedAssets(page);
  await page.route('**/v1/dq/context', (route) =>
    route.fulfill({ json: settings }),
  );
  await page.route('**/dq-ui/embedded.html', (route) =>
    route.fulfill({
      status: 503,
      body: 'DQ unavailable',
      contentType: 'text/plain',
    }),
  );
  let access = 0;
  await page.route('**/v1/dq/artifacts/a1', (route) =>
    route.fulfill({
      json: {
        artifact_id: 'a1',
        installation_id: 'test',
        namespace: 'audit',
        uri: 's3://artifacts/a1',
        version_id: 'v1',
        etag: 'etag',
        sha256: 'a'.repeat(64),
        schema_id: 'v1',
        media_type: 'application/json',
        size_bytes: 10,
      },
    }),
  );
  await page.route('**/v1/dq/artifacts/a1/access', (route) => {
    access++;
    return route.fulfill({
      json: { download_url: 'https://objects.example.test/a1?v=1' },
    });
  });
  await page.goto('/dq/artifacts/a1');
  await expect(page.getByText('Loading DQ application...')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Retry DQ', exact: true }),
  ).toBeVisible({ timeout: 15000 });
  expect(access).toBe(0);
  await page.unroute('**/dq-ui/embedded.html');
  await page.getByRole('button', { name: 'Retry DQ', exact: true }).click();
  const frame = page.frameLocator('iframe[title="DQ workspace"]');
  await expect(
    frame.getByRole('heading', { name: 'Artifact a1' }),
  ).toBeVisible();
  expect(access).toBe(0);
  await frame
    .getByRole('button', { name: 'Authorize exact-version download' })
    .click();
  await expect(
    frame.getByRole('link', { name: 'Download authorized artifact' }),
  ).toHaveAttribute('href', 'https://objects.example.test/a1?v=1');
  expect(access).toBe(1);
  await page.reload();
  await expect(
    frame.getByRole('heading', { name: 'Artifact a1' }),
  ).toBeVisible();
  expect(access).toBe(1);
});
