/**
 * PRC-M110 — the /reports board summary loads through the web BFF (Server
 * Action -> gateway), not a client fetch to a non-existent /api/v1 route.
 *
 * Gated (E2E_BACKEND_READY): needs a live gateway with at least one board in
 * the gradebook directory.
 */
import { expect, test } from '@playwright/test';
import { setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

test.describe('Board summary via web BFF (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('choosing a board renders KPI values from a 200 web-origin response', async ({ page }) => {
    const apiV1Calls: string[] = [];
    page.on('request', (req) => {
      if (new URL(req.url()).pathname.startsWith('/api/v1/reports/board/')) {
        apiV1Calls.push(req.url());
      }
    });
    await page.goto('/reports', { waitUntil: 'domcontentloaded' });
    const select = page.getByRole('combobox', { name: 'Board' });
    test.skip((await select.count()) === 0, 'No boards in the gradebook directory');
    const firstBoard = await select.locator('option:not([value=""])').first().getAttribute('value');
    test.skip(!firstBoard, 'No boards in the gradebook directory');
    await select.selectOption(firstBoard!);
    const origin = new URL(page.url()).origin;
    const [response] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().startsWith(origin) && res.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Fetch summary' }).click(),
    ]);
    expect(response.status()).toBe(200);
    const panel = page.locator('section[aria-labelledby="board-summary-heading"]');
    await expect(panel.getByText('Schools', { exact: true })).toBeVisible();
    await expect(panel.getByText('Enrolment', { exact: true })).toBeVisible();
    expect(apiV1Calls).toEqual([]);
  });
});
