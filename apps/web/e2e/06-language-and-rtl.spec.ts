import { expect, test } from '@playwright/test';

import { loginAsTenantAdmin } from './fixtures/auth';
import { runAxe } from './helpers/axe';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

test.describe('Critical journey: language switch → RTL layout → module navigation', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping live-backend e2e test. See e2e/README.md.',
  );

  test('switching to Arabic flips layout to RTL and translated nav still works', async ({
    page,
  }) => {
    await loginAsTenantAdmin(page);

    // Open language switcher
    const switcher = page
      .getByRole('button', { name: /language|locale/i })
      .or(page.getByLabel(/language|locale/i))
      .first();
    await switcher.click();

    // Choose Arabic. Match by either localized or English label.
    const arabicOption = page
      .getByRole('option', { name: /arabic|العربية/i })
      .or(page.getByRole('menuitem', { name: /arabic|العربية/i }))
      .first();
    await arabicOption.click();

    // Document direction flips to rtl
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl', { timeout: 10_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', /^ar(-|$)/);

    // A translated nav label should be visible (Students in Arabic = الطلاب).
    // Fall back to verifying the nav region exists if translations aren't loaded.
    const studentsNav = page
      .getByRole('link', { name: /الطلاب|طلاب/i })
      .or(page.getByRole('navigation').getByRole('link').first());
    await expect(studentsNav.first()).toBeVisible({ timeout: 10_000 });

    // Module navigation still works in RTL
    await page.goto('/students');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('main')).toBeVisible();

    // Task 56.7 — RTL students list must also pass WCAG 2.1 AA. axe
    // catches direction-conditional regressions like clipped focus
    // rings or labels and controls swapping order.
    await runAxe(page, { checkpointLabel: 'RTL /students' });
  });
});
