/**
 * Communication + Hostel + Library — ungated inventory smokes.
 */
import { expect, test } from '@playwright/test';

const COMMUNICATION_ROUTES = [
  { id: 'overview', path: '/communication', heading: /communication/i },
  { id: 'campaigns', path: '/communication/campaigns', heading: /campaign/i },
  { id: 'campaign-new', path: '/communication/campaigns/new', heading: /new campaign|campaign/i },
  { id: 'emergency', path: '/communication/emergency', heading: /emergency/i },
] as const;

const HOSTEL_ROUTES = [
  { id: 'overview', path: '/hostel', heading: /hostel/i },
  { id: 'structure', path: '/hostel/structure', heading: /structure|block|hostel/i },
  { id: 'assignments', path: '/hostel/assignments', heading: /assignment/i },
  { id: 'leaves', path: '/hostel/leaves', heading: /leave/i },
  { id: 'visitors', path: '/hostel/visitors', heading: /visitor/i },
] as const;

const LIBRARY_ROUTES = [
  { id: 'overview', path: '/library', heading: /library/i },
  { id: 'circulation', path: '/library/circulation', heading: /circulation/i },
  { id: 'overdues', path: '/library/overdues', heading: /overdue/i },
] as const;

test.describe('Communication — inventory smoke (ungated)', () => {
  for (const route of COMMUNICATION_ROUTES) {
    test(`${route.id} (${route.path}) unauthenticated → /login`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/login/);
      await expect(page.locator('body')).toBeVisible();
      await expect(page.getByRole('heading').first()).toBeVisible();
    });
  }
});

test.describe('Hostel — inventory smoke (ungated)', () => {
  for (const route of HOSTEL_ROUTES) {
    test(`${route.id} (${route.path}) unauthenticated → /login`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/login/);
      await expect(page.locator('body')).toBeVisible();
      await expect(page.getByRole('heading').first()).toBeVisible();
    });
  }
});

test.describe('Library — inventory smoke (ungated)', () => {
  for (const route of LIBRARY_ROUTES) {
    test(`${route.id} (${route.path}) unauthenticated → /login`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/login/);
      await expect(page.locator('body')).toBeVisible();
      await expect(page.getByRole('heading').first()).toBeVisible();
    });
  }
});
