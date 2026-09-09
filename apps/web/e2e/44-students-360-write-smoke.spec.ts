/**
 * Students 360 — photo, consents, discipline, real heatmap, ID card (Wave 9 / G-914).
 *
 * Ungated: the student list renders and an unknown profile shows not-found.
 * Gated (E2E_BACKEND_READY): live API + UI writes, heatmap from a marked
 * attendance day, ID-card PDF through the Next proxy, tenant B isolation.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
const INSTITUTION_A = 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
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
    'Content-Type': 'application/json',
    'X-Tenant-ID': tenantId,
  };
}

function stamp() {
  return Date.now().toString(36).slice(-6).toUpperCase();
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function hydrated(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await expect(el).toHaveAttribute('data-hydrated', 'true', { timeout: 20_000 });
  return el;
}

async function createStudent(request: APIRequestContext, firstName = 'Ada'): Promise<string> {
  const res = await request.post(`${GATEWAY_URL}/api/v1/students`, {
    headers: headers(),
    data: {
      firstName,
      lastName: `G914${stamp()}`,
      dateOfBirth: '2009-04-12',
      gender: 'female',
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id as string;
}

test.describe('Students 360 — pages render (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/students renders with the add-student action', async ({ page }) => {
    await page.goto('/students', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('/students/[id] shows not-found for an unknown student', async ({ page }) => {
    await page.goto('/students/00000000-0000-4000-8000-00000000dead', {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByRole('heading', { name: /page not found/i })).toBeVisible();
    await expect(page.getByTestId('student-profile-heading')).toHaveCount(0);
  });
});

test.describe('Students 360 — live chain (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('photo, consent, discipline, heatmap, and ID-card PDF round-trip', async ({
    page,
    request,
  }) => {
    const studentId = await createStudent(request);

    await page.goto(`/students/${studentId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('student-profile-heading')).toBeVisible();
    await hydrated(page, 'student-360');

    await page.getByTestId('student-photo-input').setInputFiles({
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    });
    await expect
      .poll(async () => {
        const res = await request.get(`${GATEWAY_URL}/api/v1/students/${studentId}/photo`, {
          headers: headers(),
        });
        return res.status();
      })
      .toBe(200);

    await hydrated(page, 'student-consents');
    await page.getByTestId('consent-toggle-photo').click();
    await expect
      .poll(async () => {
        const res = await request.get(`${GATEWAY_URL}/api/v1/students/${studentId}/consents`, {
          headers: headers(),
        });
        const body = (await res.json()) as { data: Array<{ kind: string; granted: boolean }> };
        return body.data.find((c) => c.kind === 'photo')?.granted ?? false;
      })
      .toBe(true);

    await page.getByTestId('discipline-add').click();
    await hydrated(page, 'discipline-form');
    await page.getByTestId('discipline-type').fill('Late to class');
    await page.getByTestId('discipline-date').fill(todayIso());
    await page.getByTestId('discipline-description').fill('Arrived 12 minutes after the bell.');
    await page.getByRole('button', { name: /save incident/i }).click();
    await expect(page.getByTestId('discipline-row')).toBeVisible({ timeout: 15_000 });

    const yearStart = shiftIso(-40);
    const yearEnd = shiftIso(40);
    const period = await request.post(`${GATEWAY_URL}/api/v1/academic-periods`, {
      headers: headers(),
      data: {
        name: `G914 ${stamp()}`,
        code: `G914-${stamp()}`,
        startDate: yearStart,
        endDate: yearEnd,
        status: 'active',
      },
    });
    expect(period.status(), await period.text()).toBe(201);
    const periodId = (await period.json()).id as string;

    const grade = await request.post(`${GATEWAY_URL}/api/v1/grades`, {
      headers: headers(),
      data: { name: `G914-${stamp()}`, code: `G9${stamp().slice(0, 4)}`, order: 6 },
    });
    expect(grade.status(), await grade.text()).toBe(201);
    const gradeId = (await grade.json()).id as string;

    const klass = await request.post(`${GATEWAY_URL}/api/v1/classes`, {
      headers: headers(),
      data: {
        institutionId: INSTITUTION_A,
        gradeId,
        academicPeriodId: periodId,
        name: `H${stamp()}`,
        capacity: 30,
      },
    });
    expect(klass.status(), await klass.text()).toBe(201);
    const classId = (await klass.json()).id as string;

    const marked = await request.post(`${GATEWAY_URL}/api/v1/attendance/student`, {
      headers: headers(),
      data: {
        studentId,
        institutionId: INSTITUTION_A,
        classId,
        academicPeriodId: periodId,
        date: todayIso(),
        status: 'PRESENT',
      },
    });
    expect(marked.status(), await marked.text()).toBe(201);

    const heatApi = await request.get(
      `${GATEWAY_URL}/api/v1/students/${studentId}/attendance-heatmap?from=${todayIso()}&to=${todayIso()}`,
      { headers: headers() },
    );
    expect(heatApi.status(), await heatApi.text()).toBe(200);
    const heat = (await heatApi.json()) as {
      totalRecords: number;
      days: Array<{ date: string; slot: string }>;
    };
    expect(heat.totalRecords).toBeGreaterThan(0);
    expect(heat.days.find((d) => d.date === todayIso())?.slot).toBe('present');

    await page.reload({ waitUntil: 'domcontentloaded' });
    const cell = page.locator(`[data-testid="heatmap-day"][data-date="${todayIso()}"]`);
    await expect(cell).toHaveAttribute('data-slot', 'present', { timeout: 15_000 });

    const card = await page.request.get(`/api/students/${studentId}/id-card`);
    expect(card.status()).toBe(200);
    expect(card.headers()['content-type']).toContain('application/pdf');
    const pdf = await card.body();
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('cross-tenant: tenant B cannot read tenant A 360 records', async ({ request }) => {
    const studentId = await createStudent(request, 'Isolated');
    const photo = await request.post(`${GATEWAY_URL}/api/v1/students/${studentId}/photo`, {
      headers: headers(),
      data: { contentBase64: PNG_1X1.toString('base64'), mimeType: 'image/png' },
    });
    expect(photo.status(), await photo.text()).toBe(201);

    const foreignPhoto = await request.get(`${GATEWAY_URL}/api/v1/students/${studentId}/photo`, {
      headers: headers(TENANT_B),
    });
    expect(foreignPhoto.status()).toBe(404);

    const foreignCard = await request.get(
      `${GATEWAY_URL}/api/v1/students/${studentId}/id-card.pdf`,
      {
        headers: headers(TENANT_B),
      },
    );
    expect(foreignCard.status()).toBe(404);

    const foreignConsent = await request.put(
      `${GATEWAY_URL}/api/v1/students/${studentId}/consents`,
      {
        headers: headers(TENANT_B),
        data: { kind: 'photo', granted: true },
      },
    );
    expect(foreignConsent.status()).toBe(404);
  });
});
