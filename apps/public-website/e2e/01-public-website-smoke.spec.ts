import { expect, test } from '@playwright/test';

/**
 * Public Website production smoke.
 * Route inventory always runs. Live contact POST is gated on E2E_BACKEND_READY.
 */
const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

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
});

test.describe('Public Website — live contact API', () => {
  test.skip(!BACKEND_READY, 'E2E_BACKEND_READY is not set; skipping live contact e2e.');

  test('contact API rejects invalid payloads', async ({ request }) => {
    const response = await request.post('/api/contact', {
      data: { name: '', email: 'bad', message: 'short' },
    });
    expect(response.status()).toBe(400);
  });

  test('contact API accepts a valid payload', async ({ request }) => {
    const response = await request.post('/api/contact', {
      data: {
        name: 'Enterprise Tester',
        email: 'tester@example.edu',
        organization: 'Proctira QA',
        message: 'Please schedule a district pilot briefing next month.',
      },
    });
    expect(response.status()).toBe(202);
  });
});
