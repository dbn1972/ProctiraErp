/**
 * Parent portal scholarship apply + documents for the caller's own child.
 */
import { expect, test } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';

const SUNRISE = '00000000-0000-4000-8000-00000000a501';
/** Seeded by tools/e2e/seed-e2e-tenants.sql. Sunrise is not loaded in the PR gate. */
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const LINKED_CHILD = '00000000-0000-4000-8000-000000000099';
const OTHER_CHILD = '00000000-0000-4000-8000-000000000094';
const INSTITUTION = '00000000-0000-4000-8000-00000000a101';
const PARENT_USER = 'parent-e2e-seeded';
const GATEWAY =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

test.describe('Parent scholarships', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page, {
      sub: 'parent-mehta',
      email: 'parent.mehta@sunrise.test',
      displayName: 'Mehta Parent',
      tenantId: SUNRISE,
      roles: [{ roleId: 'parent', roleName: 'Parent', areaId: null }],
    });
  });

  test('/parent/scholarships renders for a Sunrise parent', async ({ page }) => {
    await page.goto('/parent/scholarships', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Scholarships' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Scholarships' })).toBeVisible();
  });

  test('uploads a document only for the linked child', async ({ page, request }) => {
    test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1');
    test.setTimeout(60_000);
    await setupGatewayTenantSession(page, {
      sub: PARENT_USER,
      email: 'parent.e2e@proctira.test',
      displayName: 'E2E Parent',
      tenantId: TENANT_A,
      roles: [{ roleId: 'parent', roleName: 'Parent', areaId: null }],
    });

    const headers = {
      Authorization: `Bearer ${await sessionToken(page)}`,
      'X-Tenant-ID': TENANT_A,
      'Content-Type': 'application/json',
    };
    const programId = await openProgram(request);
    const draft = await request.post(`${GATEWAY}/api/v1/parent-portal/scholarships/applications`, {
      headers,
      data: {
        programId,
        applicantId: LINKED_CHILD,
        institutionId: INSTITUTION,
        academicRecords: [
          { institutionName: 'Sunrise Public School', educationLevel: 'secondary', gpa: 3.6 },
        ],
        financialInfo: { familyIncome: 180000 },
        documents: [],
        asDraft: true,
      },
    });
    expect(draft.status(), await draft.text()).toBe(201);
    const applicationId = (await draft.json()).id as string;

    const blocked = await request.post(
      `${GATEWAY}/api/v1/parent-portal/scholarships/applications`,
      {
        headers,
        data: {
          programId,
          applicantId: OTHER_CHILD,
          institutionId: INSTITUTION,
          academicRecords: [
            { institutionName: 'Sunrise Public School', educationLevel: 'secondary' },
          ],
          financialInfo: {},
          documents: [],
        },
      },
    );
    expect(blocked.status(), await blocked.text()).toBe(403);

    const uploaded = await request.post(
      `${GATEWAY}/api/v1/parent-portal/scholarships/applications/${applicationId}/documents`,
      {
        headers: { Authorization: headers.Authorization, 'X-Tenant-ID': TENANT_A },
        multipart: {
          documentType: 'income_certificate',
          file: { name: 'income.pdf', mimeType: 'application/pdf', buffer: PDF },
        },
      },
    );
    expect(uploaded.status(), await uploaded.text()).toBe(201);

    const list = await request.get(`${GATEWAY}/api/v1/parent-portal/scholarships/applications`, {
      headers,
    });
    expect(list.status(), await list.text()).toBe(200);
    const applicants = ((await list.json()).data as Array<{ applicantId: string }>).map(
      (row) => row.applicantId,
    );
    expect(applicants).toContain(LINKED_CHILD);
    expect(applicants).not.toContain(OTHER_CHILD);

    await page.goto('/parent/scholarships', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('parent-scholarships')).toBeVisible();
    await expect(page.getByTestId(`parent-application-${applicationId}`)).toBeVisible();
  });
});

async function openProgram(request: import('@playwright/test').APIRequestContext): Promise<string> {
  const admin = createSignedJwt({
    sub: 'e2e-admin',
    email: 'admin@sunrise.test',
    displayName: 'Sunrise Admin',
    tenantId: TENANT_A,
    roles: [{ roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null }],
  });
  const headers = {
    Authorization: `Bearer ${admin}`,
    'X-Tenant-ID': TENANT_A,
    'Content-Type': 'application/json',
  };
  const created = await request.post(`${GATEWAY}/api/v1/scholarships/programs`, {
    headers,
    data: {
      name: `Parent docs ${Date.now().toString(36)}`,
      applicationStartDate: '2020-01-01',
      applicationEndDate: '2099-12-31',
      totalSlots: 5,
      amountPerRecipient: 10000,
      currency: 'INR',
      eligibility: { requiredDocuments: ['income_certificate'] },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const programId = (await created.json()).id as string;
  const opened = await request.put(`${GATEWAY}/api/v1/scholarships/programs/${programId}`, {
    headers,
    data: { status: 'open' },
  });
  expect(opened.status(), await opened.text()).toBe(200);
  return programId;
}

async function sessionToken(page: import('@playwright/test').Page): Promise<string> {
  const cookies = await page.context().cookies();
  const access = cookies.find((cookie) => cookie.name === 'access_token');
  if (!access) throw new Error('missing access_token cookie');
  return access.value;
}
