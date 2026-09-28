/**
 * Parent portal scholarship apply + documents for the caller's own child.
 */
import { expect, test } from '@playwright/test';

import { setupGatewayTenantSession } from './fixtures/fake-session';

const SUNRISE = '00000000-0000-4000-8000-00000000a501';
const AARAV = '00000000-0000-4000-8000-00000000a5b1';
const DIYA = '00000000-0000-4000-8000-00000000a5b2';
const INSTITUTION = '00000000-0000-4000-8000-00000000a551';
const PROGRAM = '00000000-0000-4000-8000-00000000a5e1';
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

    const headers = {
      Authorization: `Bearer ${await sessionToken(page)}`,
      'X-Tenant-ID': SUNRISE,
      'Content-Type': 'application/json',
    };
    const draft = await request.post(
      `${GATEWAY}/api/v1/parent-portal/scholarships/applications`,
      {
        headers,
        data: {
          programId: PROGRAM,
          applicantId: AARAV,
          institutionId: INSTITUTION,
          academicRecords: [{ institutionName: 'Sunrise Public School', educationLevel: 'secondary', gpa: 3.6 }],
          financialInfo: { familyIncome: 180000 },
          documents: [],
          asDraft: true,
        },
      },
    );
    expect(draft.status(), await draft.text()).toBe(201);
    const applicationId = (await draft.json()).id as string;

    const blocked = await request.post(
      `${GATEWAY}/api/v1/parent-portal/scholarships/applications`,
      {
        headers,
        data: {
          programId: PROGRAM,
          applicantId: DIYA,
          institutionId: INSTITUTION,
          academicRecords: [{ institutionName: 'Sunrise Public School', educationLevel: 'secondary' }],
          financialInfo: {},
          documents: [],
        },
      },
    );
    expect(blocked.status(), await blocked.text()).toBe(403);

    const uploaded = await request.post(
      `${GATEWAY}/api/v1/parent-portal/scholarships/applications/${applicationId}/documents`,
      {
        headers: { Authorization: headers.Authorization, 'X-Tenant-ID': SUNRISE },
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
    expect(applicants).toContain(AARAV);
    expect(applicants).not.toContain(DIYA);

    await page.goto('/parent/scholarships', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('parent-scholarships')).toBeVisible();
    await expect(page.getByTestId(`parent-application-${applicationId}`)).toBeVisible();
  });
});

async function sessionToken(page: import('@playwright/test').Page): Promise<string> {
  const cookies = await page.context().cookies();
  const access = cookies.find((cookie) => cookie.name === 'access_token');
  if (!access) throw new Error('missing access_token cookie');
  return access.value;
}
