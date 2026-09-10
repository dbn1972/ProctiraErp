/**
 * Scholarship application decision — approve / reject with reviewer note
 * (Wave 9 / G-911).
 *
 * Before G-911 the Decision sidebar on `/scholarships/applications/[id]` was
 * inert (Approve / Reject buttons with no handler). It now posts to
 * `POST /scholarships/applications/:id/{approve|reject}` through a Server
 * Action, persisting reviewer + note, and approval queues the first
 * disbursement.
 *
 * Ungated: the applications list renders.
 * Gated (E2E_BACKEND_READY): program → application via API, approve from the
 * UI with a note, decision record + disbursement visible; a second
 * application is rejected; cross-tenant read denied.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
const INSTITUTION_A = 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';
/** Subject of the browser session minted by setupGatewayTenantSession. */
const SESSION_SUB = 'e2e-user';

function headers(tenantId = TENANT_A) {
  const token = createSignedJwt({
    sub: 'e2e-admin',
    email: 'admin@tenant-a.test',
    displayName: 'E2E Admin',
    tenantId,
    roles: [{ roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null }],
    institutions: [],
  });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-ID': tenantId,
  };
}

async function hydrated(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await expect(el).toHaveAttribute('data-hydrated', 'true', { timeout: 20_000 });
  return el;
}

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function randomUuid(): string {
  return crypto.randomUUID();
}

/** Open program with a live application window, plus one submitted application. */
async function seedProgramWithApplication(request: APIRequestContext, amount = 25_000) {
  const program = await request.post(`${GATEWAY_URL}/api/v1/scholarships/programs`, {
    headers: headers(),
    data: {
      name: `E2E Merit ${Date.now().toString(36)}`,
      applicationStartDate: isoDaysFromNow(-1),
      applicationEndDate: isoDaysFromNow(30),
      totalSlots: 5,
      amountPerRecipient: amount,
      currency: 'INR',
      eligibility: {},
    },
  });
  expect(program.status(), await program.text()).toBe(201);
  const programId = (await program.json()).id as string;

  const opened = await request.put(`${GATEWAY_URL}/api/v1/scholarships/programs/${programId}`, {
    headers: headers(),
    data: { status: 'open' },
  });
  expect(opened.status(), await opened.text()).toBe(200);

  const application = await submitApplication(request, programId);
  return { programId, applicationId: application };
}

async function submitApplication(request: APIRequestContext, programId: string) {
  const res = await request.post(`${GATEWAY_URL}/api/v1/scholarships/applications`, {
    headers: headers(),
    data: {
      programId,
      applicantId: randomUuid(),
      institutionId: INSTITUTION_A,
      academicRecords: [
        {
          institutionName: 'E2E Demo School',
          educationLevel: 'secondary',
          gpa: 3.7,
          yearCompleted: 2025,
        },
      ],
      financialInfo: { familyIncome: 180000, numberOfDependents: 2 },
      documents: [],
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id as string;
}

test.describe('Scholarship decision — pages render (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/scholarships/applications renders its heading', async ({ page }) => {
    await page.goto('/scholarships/applications', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

test.describe('Scholarship decision — live chain (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('approve from the UI persists reviewer + note and queues the first instalment', async ({
    page,
    request,
  }) => {
    const { applicationId } = await seedProgramWithApplication(request);

    await page.goto(`/scholarships/applications/${applicationId}`, {
      waitUntil: 'domcontentloaded',
    });
    await hydrated(page, 'decision-form');
    await page.getByTestId('decision-comment').fill('Income certificate and marksheet verified');
    await page.getByTestId('decision-approve').click();

    await expect(page.getByTestId('decision-record')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('application-status')).toHaveText('Approved');
    await expect(page.getByTestId('decision-note')).toHaveText(
      'Income certificate and marksheet verified',
    );
    // Reviewer is the browser session's JWT subject (not the API seeding
    // identity, and never something the form posted).
    await expect(page.getByTestId('decision-record')).toContainText(SESSION_SUB);

    const stored = await request.get(
      `${GATEWAY_URL}/api/v1/scholarships/applications/${applicationId}`,
      { headers: headers() },
    );
    expect(stored.status()).toBe(200);
    const body = await stored.json();
    expect(body.status).toBe('approved');
    expect(body.reviewerId).toBe(SESSION_SUB);
    expect(body.reviewNotes).toBe('Income certificate and marksheet verified');

    const disbursements = await request.get(
      `${GATEWAY_URL}/api/v1/scholarships/applications/${applicationId}/disbursements`,
      { headers: headers() },
    );
    expect(disbursements.status()).toBe(200);
    const list = await disbursements.json();
    const rows = Array.isArray(list) ? list : (list.data ?? []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: 25_000, paymentStatus: 'scheduled' });
  });

  test('reject from the UI records the decision without scheduling a payment', async ({
    page,
    request,
  }) => {
    const { applicationId } = await seedProgramWithApplication(request);

    await page.goto(`/scholarships/applications/${applicationId}`, {
      waitUntil: 'domcontentloaded',
    });
    await hydrated(page, 'decision-form');
    await page.getByTestId('decision-comment').fill('Family income above threshold');
    await page.getByTestId('decision-reject').click();

    await expect(page.getByTestId('application-status')).toHaveText('Rejected', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('decision-note')).toHaveText('Family income above threshold');

    const disbursements = await request.get(
      `${GATEWAY_URL}/api/v1/scholarships/applications/${applicationId}/disbursements`,
      { headers: headers() },
    );
    const list = await disbursements.json();
    const rows = Array.isArray(list) ? list : (list.data ?? []);
    expect(rows).toHaveLength(0);
  });

  test('a decided application cannot be decided again', async ({ request }) => {
    const { applicationId } = await seedProgramWithApplication(request);
    const first = await request.post(
      `${GATEWAY_URL}/api/v1/scholarships/applications/${applicationId}/reject`,
      { headers: headers(), data: { comment: 'first' } },
    );
    expect(first.status()).toBe(200);
    const again = await request.post(
      `${GATEWAY_URL}/api/v1/scholarships/applications/${applicationId}/approve`,
      { headers: headers(), data: {} },
    );
    expect(again.status()).toBeGreaterThanOrEqual(400);
    expect(again.status()).toBeLessThan(500);
  });

  test('cross-tenant: tenant B cannot read or decide tenant A application', async ({ request }) => {
    const { applicationId } = await seedProgramWithApplication(request);
    const read = await request.get(
      `${GATEWAY_URL}/api/v1/scholarships/applications/${applicationId}`,
      { headers: headers(TENANT_B) },
    );
    expect([403, 404]).toContain(read.status());
    const decide = await request.post(
      `${GATEWAY_URL}/api/v1/scholarships/applications/${applicationId}/approve`,
      { headers: headers(TENANT_B), data: {} },
    );
    expect([403, 404]).toContain(decide.status());
  });
});
