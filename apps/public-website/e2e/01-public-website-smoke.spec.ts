import { expect, test } from '@playwright/test';

/**
 * Public Website production smoke.
 * Route inventory + contact API validation always run (Next route handlers).
 * Optional CRM webhook forward is documented; without CONTACT_WEBHOOK_URL,
 * accept still returns 202 with forwarded:false (honest residual).
 *
 * Status page env (documented):
 *   STATUS_PROBE_WEB_URL / STATUS_PROBE_API_URL / STATUS_PROBE_AUTH_URL
 * Contact webhook env:
 *   CONTACT_WEBHOOK_URL — optional CRM/ticketing forward from POST /api/contact
 */
const PUBLIC_ROUTES: ReadonlyArray<string> = [
  '/',
  '/product',
  '/installation',
  '/security',
  '/compliance',
  '/status',
  '/about',
  '/contact',
  '/legal',
  '/privacy',
  '/terms',
  '/cookies',
];

test.describe('Public Website — public surfaces', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} renders`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.ok()).toBeTruthy();
      await expect(page.locator('body')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });
  }

  test('contact form exposes required fields', async ({ page }) => {
    await page.goto('/contact');
    await expect(page.getByLabel(/^name$/i)).toBeVisible();
    await expect(page.getByLabel(/work email|email/i).first()).toBeVisible();
    await expect(page.getByLabel(/how can we help|message/i).first()).toBeVisible();
  });

  test('header login does not point at dead /login', async ({ page }) => {
    await page.goto('/');
    const login = page.getByRole('link', { name: /^login$/i }).first();
    await expect(login).toBeVisible();
    const href = await login.getAttribute('href');
    expect(href).toBeTruthy();
    expect(href).not.toBe('/login');
  });

  test('status page is honest when probes are not configured', async ({ page }) => {
    await page.goto('/status');
    const overall = page.getByTestId('status-overall');
    await expect(overall).toBeVisible();
    await expect(overall).toHaveAttribute('data-mode', 'prelaunch');
    await expect(overall).toContainText(/not instrumented|partial instrumentation/i);
    await expect(page.getByText(/not monitored/i).first()).toBeVisible();
    await expect(page.getByText(/^operational$/i)).toHaveCount(0);
  });
});

test.describe('Public Website — contact API (Next route, always-on)', () => {
  test('contact API rejects invalid payloads', async ({ request }) => {
    const response = await request.post('/api/contact', {
      data: { name: '', email: 'bad', message: 'short' },
    });
    expect(response.status()).toBe(400);
  });

  test('contact API accepts a valid payload (webhook optional)', async ({ request }) => {
    const response = await request.post('/api/contact', {
      data: {
        name: 'Enterprise Tester',
        email: 'tester@example.edu',
        organization: 'Proctira QA',
        message: 'Please schedule a district pilot briefing next month.',
      },
    });
    expect(response.status()).toBe(202);
    const body = (await response.json()) as { ok?: boolean; forwarded?: boolean };
    expect(body.ok).toBe(true);
    // Without CONTACT_WEBHOOK_URL, forwarded stays false — do not invent CRM success.
    expect(typeof body.forwarded).toBe('boolean');
  });
});
