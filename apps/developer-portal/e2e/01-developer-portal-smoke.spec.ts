import { expect, test } from '@playwright/test';

import { runAxe } from './helpers/axe';

/**
 * Developer Portal production smoke.
 * Route inventory + axe always run. Live API-key issuance gates on E2E_BACKEND_READY.
 */
const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

const DEVELOPER_ROUTES: ReadonlyArray<{ path: string; heading: RegExp }> = [
  { path: '/', heading: /build for|every school/i },
  { path: '/docs', heading: /^documentation$/i },
  { path: '/dashboard', heading: /developer dashboard/i },
  { path: '/marketplace', heading: /plugin marketplace/i },
];

test.describe('Developer Portal — public surfaces', () => {
  for (const route of DEVELOPER_ROUTES) {
    test(`${route.path} renders`, async ({ page }) => {
      const response = await page.goto(route.path);
      expect(response?.ok()).toBeTruthy();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(route.heading);
    });
  }

  test('primary nav links are wired (no 404 stubs)', async ({ page }) => {
    await page.goto('/');
    const expected: ReadonlyArray<{ name: RegExp; href: RegExp }> = [
      { name: /^Docs$/i, href: /\/docs/ },
      { name: /^API Reference$/i, href: /\/docs/ },
      { name: /^Plugins$/i, href: /\/marketplace/ },
      { name: /Get API key/i, href: /\/dashboard/ },
    ];
    for (const item of expected) {
      const link = page.getByRole('link', { name: item.name }).first();
      await expect(link).toBeVisible();
      const href = await link.getAttribute('href');
      expect(href).toBeTruthy();
      expect(href).not.toMatch(/^#/);
      expect(href).toMatch(item.href);
    }
  });

  test('docs index includes sample curl and sections', async ({ page }) => {
    await page.goto('/docs');
    await expect(page.getByTestId('docs-sample-curl')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Quickstart' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Plugin SDK' })).toBeVisible();
  });

  test('dashboard API key demo validates locally', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('dashboard-honesty-banner')).toBeVisible();
    await page.getByTestId('api-key-demo-submit').click();
    await expect(page.getByTestId('api-key-demo-error')).toContainText(/required|3 characters/i);
    await page.getByLabel(/key name/i).fill('ab');
    await page.getByTestId('api-key-demo-submit').click();
    await expect(page.getByTestId('api-key-demo-error')).toContainText(/at least 3 characters/i);
    await page.getByLabel(/key name/i).fill('Attendance sync');
    await page.getByTestId('api-key-demo-submit').click();
    await expect(page.getByTestId('api-key-demo-ack')).toContainText(/demo only/i);
  });

  test('marketplace lists fixture plugins and filters', async ({ page }) => {
    await page.goto('/marketplace');
    await expect(page.getByTestId('marketplace-honesty-banner')).toBeVisible();
    await expect(page.getByTestId('marketplace-plugin-attendance-sms-bridge')).toBeVisible();
    await expect(
      page.getByTestId('marketplace-install-attendance-sms-bridge'),
    ).toBeDisabled();
    await page.getByTestId('marketplace-search').fill('OIDC');
    await expect(page.getByTestId('marketplace-plugin-oidc-school-sso')).toBeVisible();
    await expect(page.getByTestId('marketplace-plugin-attendance-sms-bridge')).toHaveCount(0);
    await page.getByTestId('marketplace-search').fill('zzzz-no-match');
    await expect(page.getByTestId('marketplace-empty')).toBeVisible();
  });

  test('health endpoint reports developer-portal', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toMatchObject({ status: 'ok', service: 'developer-portal' });
  });
});

test.describe('Developer Portal — axe WCAG 2.1 AA', () => {
  for (const route of DEVELOPER_ROUTES) {
    test(`${route.path} has no critical axe violations`, async ({ page }) => {
      await page.goto(route.path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await runAxe(page, { checkpointLabel: route.path });
    });
  }
});

test.describe('Developer Portal — live API keys', () => {
  test.skip(!BACKEND_READY, 'E2E_BACKEND_READY is not set; skipping live API-key e2e.');

  test('placeholder for keyed dashboard once auth ships', async () => {
    expect(BACKEND_READY).toBe(true);
  });
});
