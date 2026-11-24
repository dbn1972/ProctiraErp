import type { Page } from '@playwright/test';

/**
 * PRC-M467: the wizard asks for the operator bootstrap secret before any install session.
 * The Playwright web server is started with this value (playwright.config.ts).
 */
export const E2E_BOOTSTRAP_SECRET =
  process.env.E2E_INSTALL_BOOTSTRAP_SECRET ?? 'e2e-install-bootstrap-secret';

/**
 * Pass the operator gate for UI-only checks. Session issuance is stubbed so UI tests do not
 * depend on (or race with) the global install lock that the BFF lock test engages.
 */
export async function unlockWizard(page: Page): Promise<void> {
  await page.route('**/api/install/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'e2e-csrf', installToken: 'e2e-install-token' }),
    }),
  );
  await page.getByLabel('Bootstrap secret').fill(E2E_BOOTSTRAP_SECRET);
  await page.getByRole('button', { name: 'Start setup' }).click();
}
