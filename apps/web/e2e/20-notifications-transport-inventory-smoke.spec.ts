/**
 * Notifications + Transport — ungated inventory smokes.
 */
import { expect, test } from '@playwright/test';

const NOTIFICATION_ROUTES = [
  { id: 'inbox', path: '/notifications', heading: /notification/i },
  {
    id: 'preferences',
    path: '/notifications/preferences',
    heading: /notification preferences|notifications/i,
  },
  { id: 'rules', path: '/admin/notification-rules', heading: /notification rules/i },
] as const;

const TRANSPORT_ROUTES = [
  { id: 'overview', path: '/transport', heading: /transport/i },
  { id: 'routes', path: '/transport/routes', heading: /route/i },
  { id: 'route-new', path: '/transport/routes/new', heading: /new transport route|route/i },
  { id: 'vehicles', path: '/transport/vehicles', heading: /vehicle/i },
  { id: 'assignments', path: '/transport/assignments', heading: /assignment/i },
] as const;

test.describe('Notifications — inventory smoke (ungated)', () => {
  for (const route of NOTIFICATION_ROUTES) {
    test(`${route.id} (${route.path}) unauthenticated → /login`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/login/);
      await expect(page.locator('body')).toBeVisible();
      await expect(page.getByRole('heading').first()).toBeVisible();
    });
  }
});

test.describe('Transport — inventory smoke (ungated)', () => {
  for (const route of TRANSPORT_ROUTES) {
    test(`${route.id} (${route.path}) unauthenticated → /login`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/login/);
      await expect(page.locator('body')).toBeVisible();
      await expect(page.getByRole('heading').first()).toBeVisible();
    });
  }
});
