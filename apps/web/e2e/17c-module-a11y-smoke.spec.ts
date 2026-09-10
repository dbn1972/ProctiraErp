import { expect, test } from '@playwright/test';

import { setupGatewayTenantSession } from './fixtures/fake-session';
import { runAxe } from './helpers/axe';

/**
 * G-402 — Minimal authenticated axe smoke for Health + Scholarships.
 *
 * Uses HS256 cookies (`setupGatewayTenantSession`) so it runs under the
 * G-401 backend-ready harness without seeded password login / IdP.
 * Full module matrix remains in `a11y-axe.spec.ts`.
 */

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

test.describe('Module a11y smoke — health + scholarships (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 (G-401 harness)');

  for (const path of [
    '/health',
    '/health/counselling',
    '/scholarships',
    '/scholarships/applications',
    '/lms',
    '/lms/pal',
  ] as const) {
    test(`${path} is WCAG 2.1 AA clean`, async ({ page }) => {
      await setupGatewayTenantSession(page);
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
      await runAxe(page, { checkpointLabel: path });
    });
  }
});
