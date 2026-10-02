/**
 * Scholarship supporting documents — upload a small PDF and verify it.
 * Ungated: the apply page renders. Gated: live gateway + Postgres.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const INSTITUTION_A = 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';
const APPLICANT_STUDENT_A = '00000000-0000-4000-8000-000000000094';

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

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
    'X-Tenant-ID': tenantId,
  };
}

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function hydrated(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await expect(async () => {
    await expect(el).toHaveCount(1, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return el;
}

test.describe('Scholarship documents — pages render (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/scholarships/apply renders the application heading', async ({ page }) => {
    await page.goto('/scholarships/apply', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /apply for scholarship/i })).toBeVisible();
  });
});

test.describe('Scholarship documents — live upload (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('uploads a small PDF and a reviewer verifies it', async ({ page, request }) => {
    test.setTimeout(60_000);
    const applicationId = await seedDraft(request);
    const uploaded = await request.post(
      `${GATEWAY_URL}/api/v1/scholarships/applications/${applicationId}/documents`,
      {
        headers: headers(),
        multipart: {
          documentType: 'income_certificate',
          file: {
            name: 'income-certificate.pdf',
            mimeType: 'application/pdf',
            buffer: PDF,
          },
        },
      },
    );
    expect(uploaded.status(), await uploaded.text()).toBe(201);
    const documentId = (await uploaded.json()).id as string;

    const missing = await request.post(
      `${GATEWAY_URL}/api/v1/scholarships/applications/${applicationId}/submit`,
      { headers: headers() },
    );
    expect(missing.status(), await missing.text()).toBe(400);
    expect(await missing.text()).toMatch(/marksheet/);

    const marksheet = await request.post(
      `${GATEWAY_URL}/api/v1/scholarships/applications/${applicationId}/documents`,
      {
        headers: headers(),
        multipart: {
          documentType: 'marksheet',
          file: { name: 'marksheet.pdf', mimeType: 'application/pdf', buffer: PDF },
        },
      },
    );
    expect(marksheet.status(), await marksheet.text()).toBe(201);
    const marksheetId = (await marksheet.json()).id as string;

    const submitted = await request.post(
      `${GATEWAY_URL}/api/v1/scholarships/applications/${applicationId}/submit`,
      { headers: headers() },
    );
    expect(submitted.status(), await submitted.text()).toBe(200);

    const download = await request.get(
      `${GATEWAY_URL}/api/v1/scholarships/applications/${applicationId}/documents/${documentId}/download`,
      { headers: headers() },
    );
    expect(download.status(), await download.text()).toBe(200);
    const signed = (await download.json()) as { url: string; expiresAt: string };
    expect(signed.expiresAt).toBeTruthy();
    const signedUrl = signed.url.startsWith('http') ? signed.url : `${GATEWAY_URL}${signed.url}`;
    const file = await request.get(signedUrl);
    expect(file.status(), await file.text()).toBe(200);
    expect((await file.body()).toString('utf8')).toContain('%PDF');

    await page.goto(`/scholarships/applications/${applicationId}`, {
      waitUntil: 'domcontentloaded',
    });
    await hydrated(page, 'scholarship-documents');
    await expect(page.getByText('Income certificate')).toBeVisible();
    await page.getByTestId(`document-verify-${documentId}`).click();
    await expect(page.getByTestId(`scholarship-document-${documentId}`)).toContainText('VERIFIED', {
      timeout: 20_000,
    });

    await page.locator(`#reject-reason-${applicationId}`).fill('The marksheet scan is unreadable');
    await page.getByTestId(`document-reject-${marksheetId}`).click();
    await page.getByTestId('scholarship-document-reject-confirm').click();
    await expect(page.getByTestId(`scholarship-document-${marksheetId}`)).toContainText(
      'REJECTED',
      {
        timeout: 20_000,
      },
    );
    await expect(page.getByTestId(`scholarship-document-${marksheetId}`)).toContainText(
      'unreadable',
    );
  });
});

async function seedDraft(request: APIRequestContext): Promise<string> {
  const program = await request.post(`${GATEWAY_URL}/api/v1/scholarships/programs`, {
    headers: { ...headers(), 'Content-Type': 'application/json' },
    data: {
      name: `E2E Docs ${Date.now().toString(36)}`,
      applicationStartDate: isoDaysFromNow(-1),
      applicationEndDate: isoDaysFromNow(30),
      totalSlots: 5,
      amountPerRecipient: 10000,
      currency: 'INR',
      eligibility: { requiredDocuments: ['income_certificate', 'marksheet'] },
    },
  });
  expect(program.status(), await program.text()).toBe(201);
  const programId = (await program.json()).id as string;
  const opened = await request.put(`${GATEWAY_URL}/api/v1/scholarships/programs/${programId}`, {
    headers: { ...headers(), 'Content-Type': 'application/json' },
    data: { status: 'open' },
  });
  expect(opened.status(), await opened.text()).toBe(200);
  const draft = await request.post(`${GATEWAY_URL}/api/v1/scholarships/applications`, {
    headers: { ...headers(), 'Content-Type': 'application/json' },
    data: {
      programId,
      // PRC-H030: applicant must be a seeded tenant-A student (seed-e2e-tenants.sql).
      applicantId: APPLICANT_STUDENT_A,
      institutionId: INSTITUTION_A,
      academicRecords: [
        {
          institutionName: 'E2E Demo School',
          educationLevel: 'secondary',
          gpa: 3.4,
          yearCompleted: 2025,
        },
      ],
      financialInfo: { familyIncome: 120000 },
      documents: [],
      asDraft: true,
    },
  });
  expect(draft.status(), await draft.text()).toBe(201);
  return (await draft.json()).id as string;
}
