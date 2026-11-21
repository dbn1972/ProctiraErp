import { expect, test, type Page } from '@playwright/test';
import { liveJourneyGate } from './helpers/live-gate';

/**
 * PRC-M568 — live public admissions journey: submit -> track, plus negatives.
 *
 * Runs against a real gateway + seeded tenant/institution/published form:
 *   E2E_BACKEND_READY=1
 *   E2E_REGISTRATION_INSTITUTION_ID=<uuid of an institution whose published
 *     form has no required custom fields or documents>
 *   E2E_REGISTRATION_TYPE=<apply slug, default "primary">
 *
 * Fail closed: on main (GITHUB_REF=refs/heads/main) or with
 * E2E_REQUIRE_LIVE=1 a missing backend is a failure, not a silent skip.
 * Backend-less lanes on main opt out only with E2E_LIVE_LANE=none, which
 * E2E_REQUIRE_LIVE=1 overrides (see helpers/live-gate.ts).
 */
const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const LIVE_GATE = liveJourneyGate();
const INSTITUTION_ID = process.env.E2E_REGISTRATION_INSTITUTION_ID ?? '';
const TYPE = process.env.E2E_REGISTRATION_TYPE ?? 'primary';

/**
 * Fills step 1 and moves to /documents.
 *
 * RegistrationProvider replaces the whole draft in its mount effect, so a fill
 * that lands before that effect runs is lost (CI run 43360874584: First Name
 * "Required", URL stayed on step 1). Wait until React has hydrated the form
 * (a click before that submits the form natively and drops ?institutionId),
 * then fill and press Next until step 2 loads.
 */
async function completePersonalStep(
  page: Page,
  applicant: { lastName: string; dob: string; gender: 'male' | 'female' },
) {
  await page.waitForFunction(() => {
    const button = document.querySelector('main form button[type="submit"]');
    return !!button && Object.keys(button).some((key) => key.startsWith('__reactProps$'));
  });
  await expect(async () => {
    if (/\/documents/.test(page.url())) return;
    const step = { timeout: 2_000 };
    await page.getByLabel(/first name/i).fill('E2E', step);
    await page.getByLabel(/last name/i).fill(applicant.lastName, step);
    await page.getByLabel(/date of birth/i).fill(applicant.dob, step);
    await page.locator('#gender').selectOption(applicant.gender, step);
    await page.getByLabel(/guardian name/i).fill('E2E Guardian', step);
    await page.getByLabel(/guardian phone/i).fill('+911234567890', step);
    await page.getByRole('button', { name: /^next$/i }).click(step);
    await expect(page).toHaveURL(/\/documents/, { timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
}

test.describe('Registration Portal — live gate', () => {
  test('live journey is configured where it is required', () => {
    test.skip(!LIVE_GATE.required, LIVE_GATE.reason);
    expect(BACKEND_READY, 'E2E_BACKEND_READY must be set on main / E2E_REQUIRE_LIVE').toBe(true);
    expect(INSTITUTION_ID, 'E2E_REGISTRATION_INSTITUTION_ID must be seeded').not.toBe('');
  });
});

test.describe('Registration Portal — live submit and track', () => {
  test.skip(!BACKEND_READY, 'E2E_BACKEND_READY is not set; skipping live registration journey.');
  test.describe.configure({ mode: 'serial' });

  const dob = '2018-04-12';
  let trackingNumber = '';

  test('applicant submits and receives a tracking number', async ({ page }) => {
    expect(INSTITUTION_ID, 'E2E_REGISTRATION_INSTITUTION_ID must be seeded').not.toBe('');
    await page.goto(`/apply/${TYPE}?institutionId=${encodeURIComponent(INSTITUTION_ID)}`);
    await completePersonalStep(page, {
      lastName: `Applicant${Date.now() % 100000}`,
      dob,
      gender: 'female',
    });

    await expect(page).toHaveURL(/\/documents/);
    await page.getByRole('button', { name: /^next$/i }).click();

    await expect(page).toHaveURL(/\/review/);
    await page.getByRole('button', { name: /^submit$/i }).click();

    await expect(page).toHaveURL(/\/apply\/success/, { timeout: 30_000 });
    const number = page.getByText(/^REG-[A-Z0-9]{8}$/);
    await expect(number).toBeVisible();
    trackingNumber = (await number.textContent())!.trim();
  });

  test('the submitted application is found with the right DOB', async ({ page }) => {
    expect(trackingNumber).toMatch(/^REG-[A-Z0-9]{8}$/);
    await page.goto('/track');
    await page.getByLabel(/tracking number/i).fill(trackingNumber);
    await page.getByLabel(/date of birth|dob/i).fill(dob);
    await page.getByRole('button', { name: /check status/i }).click();
    await expect(page).not.toHaveURL(/[?&]dob=/);
    await expect(page.getByText(/pending review|under review/i).first()).toBeVisible();
  });

  test('a wrong DOB does not reveal the application', async ({ page }) => {
    expect(trackingNumber).toMatch(/^REG-[A-Z0-9]{8}$/);
    await page.goto('/track');
    await page.getByLabel(/tracking number/i).fill(trackingNumber);
    await page.getByLabel(/date of birth|dob/i).fill('2017-01-01');
    await page.getByRole('button', { name: /check status/i }).click();
    await expect(page.getByText(/no application was found/i).first()).toBeVisible();
    await expect(page.getByText(/pending review|under review/i)).toHaveCount(0);
  });

  test('backend down: submit shows an error instead of a fake success', async ({ page }) => {
    expect(INSTITUTION_ID).not.toBe('');
    await page.route(/\/api\/registrations(\?|$)/, (route) =>
      route.request().method() === 'POST' ? route.abort('connectionrefused') : route.continue(),
    );
    await page.goto(`/apply/${TYPE}?institutionId=${encodeURIComponent(INSTITUTION_ID)}`);
    await completePersonalStep(page, { lastName: 'Down', dob, gender: 'male' });
    // Wait for each step: a second "Next" clicked before the client-side
    // navigation lands hits the previous step's button (UAT-API-004 flake).
    await expect(page).toHaveURL(/\/documents/);
    await page.getByRole('button', { name: /^next$/i }).click();
    await expect(page).toHaveURL(/\/review/);
    await page.getByRole('button', { name: /^submit$/i }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page).not.toHaveURL(/\/apply\/success/);
  });
});
