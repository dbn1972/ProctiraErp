import { expect, test } from '@playwright/test';

import { runAxe } from './helpers/axe';

/**
 * E2E for the public Application Tracking page (Task 51.4 / Requirement 16.6, 16.11).
 *
 * The page is anonymous-accessible — no login fixture needed. We mock the
 * public registration endpoint at the network layer so the suite stays
 * green even when the backend isn't running, but the request shape itself
 * is asserted against the same contract the design specifies.
 */

const TRACKING_NUMBER = 'REG-A1B2C3D4';

const SAMPLE_RESPONSE = {
  trackingNumber: TRACKING_NUMBER,
  status: 'under_review',
  currentStep: 'Document review',
  submittedAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-03T00:00:00Z',
  expectedCompletionAt: '2025-01-15T00:00:00Z',
  history: [
    {
      status: 'pending',
      timestamp: '2025-01-01T00:00:00Z',
      note: 'Application received',
    },
    {
      status: 'under_review',
      timestamp: '2025-01-03T00:00:00Z',
      note: 'Documents being verified',
    },
  ],
  followUpActions: [
    {
      code: 'UPLOAD_BIRTH_CERT',
      message: 'Please upload a birth certificate',
    },
  ],
};

/** Match both the current `/registrations/.../status` path and the legacy alias. */
const TRACKING_API_GLOB = '**/api/v1/registrations/**';

test.describe('Public Application Tracking page', () => {
  test('renders the form, submits a tracking number, and shows the status timeline', async ({
    page,
  }) => {
    let requestedUrl: string | null = null;

    // Intercept the public read-only endpoint and reply with the sample
    // payload. We match by URL path so the test does not care which port
    // the dev server is on.
    await page.route(TRACKING_API_GLOB, async (route) => {
      requestedUrl = route.request().url();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SAMPLE_RESPONSE),
      });
    });

    await page.goto('/track');

    // The form is visible and exposes a labelled input.
    const input = page.getByLabel(/tracking number/i);
    await expect(input).toBeVisible();

    // Task 56.7 — initial form state must pass WCAG 2.1 AA before the
    // user does anything. This is the most-visited public surface so a
    // regression here is the most damaging.
    await runAxe(page, { checkpointLabel: '/track (form)' });

    await input.fill(TRACKING_NUMBER);
    await page.getByRole('button', { name: /check status/i }).click();

    // The status timeline appears with both history entries.
    await expect(page.getByTestId('tracking-result')).toBeVisible();
    await expect(page.getByTestId('history-timeline')).toBeVisible();
    const items = page.getByTestId('timeline-item');
    await expect(items).toHaveCount(2);

    // The follow-up section shows the action message.
    await expect(
      page.getByText(/please upload a birth certificate/i),
    ).toBeVisible();

    // The status badge shows the localized "Under review" label.
    await expect(page.getByTestId('status-badge')).toHaveText(/under review/i);

    // The browser actually called the public registration endpoint with
    // the encoded tracking number from the form.
    expect(requestedUrl).not.toBeNull();
    expect(requestedUrl).toContain(
      `/api/v1/registrations/${TRACKING_NUMBER}/status`,
    );

    // Task 56.7 — populated result state must also pass WCAG 2.1 AA.
    // The badge, timeline, and follow-up alert each introduce
    // additional roles and color-coded statuses, so we run axe a
    // second time once the data has rendered.
    await runAxe(page, { checkpointLabel: '/track (result)' });
  });

  test('shows the friendly "not found" alert on a 404', async ({ page }) => {
    await page.route(TRACKING_API_GLOB, async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'NOT_FOUND' }),
      });
    });

    await page.goto('/track');
    await page.getByLabel(/tracking number/i).fill('REG-MISSING');
    await page.getByRole('button', { name: /check status/i }).click();

    await expect(page.getByTestId('tracking-not-found')).toBeVisible();
    await expect(page.getByText(/application not found/i)).toBeVisible();
  });

  test('rejects an empty tracking number client-side', async ({ page }) => {
    let networkCalls = 0;
    await page.route(TRACKING_API_GLOB, async (route) => {
      networkCalls += 1;
      await route.fulfill({ status: 200, body: '{}' });
    });

    await page.goto('/track');
    await page.getByRole('button', { name: /check status/i }).click();

    await expect(page.getByText(/tracking number is required/i)).toBeVisible();
    expect(networkCalls).toBe(0);
  });
});
