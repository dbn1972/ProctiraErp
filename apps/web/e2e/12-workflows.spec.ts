import { expect, test } from '@playwright/test';

import { loginAsTenantAdmin } from './fixtures/auth';

/**
 * Workflows module production smoke (redesign nav screens).
 *
 * Screens: definitions, new definition, definition detail, instances, approvals.
 * Intended to run headless on the cloud agent / CI host (no laptop dependency).
 */
const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const DEFINITION_ID =
  process.env.WORKFLOW_DEFINITION_ID ?? 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';

test.describe('Workflows E2E', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping live-backend workflows e2e.',
  );

  test.beforeEach(async ({ page }) => {
    await loginAsTenantAdmin(page);
  });

  test('definitions list renders heading and navigation CTAs', async ({ page }) => {
    await page.goto('/workflows');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /new definition/i }).first()).toBeVisible();
    await expect(
      page.getByRole('link', { name: /instances|approvals|my approvals/i }).first(),
    ).toBeVisible();
  });

  test('new definition form exposes required fields', async ({ page }) => {
    await page.goto('/workflows/definitions/new');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('#wf-name')).toBeVisible();
    await expect(page.locator('#wf-module')).toBeVisible();
    await expect(page.locator('#wf-steps')).toBeVisible();
    await expect(page.getByRole('button', { name: /create definition/i })).toBeVisible();
  });

  test('definition detail route resolves for seeded definition', async ({ page }) => {
    await page.goto(`/workflows/definitions/${DEFINITION_ID}`);
    await expect(page.locator('h1').first()).toBeVisible();
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(20);
  });

  test('instances list renders', async ({ page }) => {
    await page.goto('/workflows/instances');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('approvals list renders heading', async ({ page }) => {
    await page.goto('/workflows/approvals');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
