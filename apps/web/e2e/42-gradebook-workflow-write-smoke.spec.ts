/**
 * Gradebook workflow — submit → approve → lock → publish (Wave 9 / G-907).
 *
 * Ungated: institution gradebook, outcomes, and report-cards pages render.
 * Gated (E2E_BACKEND_READY): live API transitions, TEACHER cannot APPROVE,
 * published grades are readable, UI hydrates workflow controls.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
/** Seeded by tools/e2e/seed-e2e-tenants.sql. */
const INSTITUTION_A = 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';

function headers(
  tenantId = TENANT_A,
  roles: Array<{ roleId: string; roleName: string; areaId: null }> = [
    { roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null },
  ],
) {
  const token = createSignedJwt({
    sub: roles[0]?.roleId === 'teacher' ? 'e2e-teacher' : 'e2e-admin',
    email: roles[0]?.roleId === 'teacher' ? 'teacher@tenant-a.test' : 'admin@tenant-a.test',
    displayName: roles[0]?.roleId === 'teacher' ? 'E2E Teacher' : 'E2E Admin',
    tenantId,
    roles,
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

function uuid() {
  return randomUUID();
}

async function hydrated(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await expect(el).toHaveAttribute('data-hydrated', 'true', { timeout: 20_000 });
  return el;
}

async function putEntry(
  request: APIRequestContext,
  input: { sectionId: string; studentId: string; assessmentCode: string },
) {
  const res = await request.put(`${GATEWAY_URL}/api/v1/gradebook/entries`, {
    headers: headers(),
    data: {
      sectionId: input.sectionId,
      studentId: input.studentId,
      assessmentCode: input.assessmentCode,
      numericScore: 88,
    },
  });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as { id: string };
}

test.describe('Gradebook workflow — pages render (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/institutions/[id]/gradebook renders the Gradebook heading', async ({ page }) => {
    await page.goto(`/institutions/${INSTITUTION_A}/gradebook`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Gradebook' })).toBeVisible();
  });

  test('/assessments/outcomes renders', async ({ page }) => {
    await page.goto('/assessments/outcomes', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /learning outcomes/i })).toBeVisible();
  });

  test('/assessments/report-cards renders', async ({ page }) => {
    await page.goto('/assessments/report-cards', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /report cards/i })).toBeVisible();
  });
});

test.describe('Gradebook workflow — live chain (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('submit → approve → lock → publish then GET /published', async ({ page, request }) => {
    const studentId = uuid();
    const sectionId = uuid();
    const assessmentCode = `GB-${stamp()}`;
    const entry = await putEntry(request, { sectionId, studentId, assessmentCode });

    const submit = await request.post(
      `${GATEWAY_URL}/api/v1/gradebook/entries/${entry.id}/transition`,
      { headers: headers(), data: { action: 'submit' } },
    );
    expect(submit.status(), await submit.text()).toBe(200);

    const approve = await request.post(
      `${GATEWAY_URL}/api/v1/gradebook/entries/${entry.id}/transition`,
      { headers: headers(), data: { action: 'approve' } },
    );
    expect(approve.status(), await approve.text()).toBe(200);

    const lock = await request.post(
      `${GATEWAY_URL}/api/v1/gradebook/entries/${entry.id}/transition`,
      { headers: headers(), data: { action: 'lock' } },
    );
    expect(lock.status(), await lock.text()).toBe(200);

    const publish = await request.post(
      `${GATEWAY_URL}/api/v1/gradebook/entries/${entry.id}/transition`,
      { headers: headers(), data: { action: 'publish' } },
    );
    expect(publish.status(), await publish.text()).toBe(200);
    const publishedBody = await publish.json();
    expect(publishedBody.publishedAt).toBeTruthy();

    const listed = await request.get(
      `${GATEWAY_URL}/api/v1/gradebook/published?studentId=${studentId}`,
      { headers: headers() },
    );
    expect(listed.status()).toBe(200);
    const rows = (await listed.json()).data as Array<{ id: string; assessmentCode: string }>;
    expect(rows.some((r) => r.id === entry.id)).toBe(true);

    await page.goto(`/institutions/${INSTITUTION_A}/gradebook`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Gradebook' })).toBeVisible();
    const panel = page.getByTestId('gradebook-workflow-panel');
    if ((await panel.count()) > 0) {
      await hydrated(page, 'gradebook-workflow-panel');
    }
  });

  test('TEACHER cannot APPROVE a submitted grade', async ({ request }) => {
    const entry = await putEntry(request, {
      sectionId: uuid(),
      studentId: uuid(),
      assessmentCode: `TCH-${stamp()}`,
    });
    const submit = await request.post(
      `${GATEWAY_URL}/api/v1/gradebook/entries/${entry.id}/transition`,
      { headers: headers(), data: { action: 'submit' } },
    );
    expect(submit.status(), await submit.text()).toBe(200);

    const teacherHeaders = headers(TENANT_A, [
      { roleId: 'teacher', roleName: 'TEACHER', areaId: null },
    ]);
    const approve = await request.post(
      `${GATEWAY_URL}/api/v1/gradebook/entries/${entry.id}/transition`,
      { headers: teacherHeaders, data: { action: 'approve' } },
    );
    expect(approve.status(), await approve.text()).toBe(403);
  });

  test('cross-tenant: tenant B cannot read tenant A published grades', async ({ request }) => {
    const studentId = uuid();
    const entry = await putEntry(request, {
      sectionId: uuid(),
      studentId,
      assessmentCode: `X-${stamp()}`,
    });
    for (const action of ['submit', 'approve', 'lock', 'publish'] as const) {
      const res = await request.post(
        `${GATEWAY_URL}/api/v1/gradebook/entries/${entry.id}/transition`,
        { headers: headers(), data: { action } },
      );
      expect(res.status(), await res.text()).toBe(200);
    }

    const foreign = await request.get(
      `${GATEWAY_URL}/api/v1/gradebook/published?studentId=${studentId}`,
      { headers: headers(TENANT_B) },
    );
    expect(foreign.status()).toBe(200);
    const rows = (await foreign.json()).data as Array<{ id: string }>;
    expect(rows.some((r) => r.id === entry.id)).toBe(false);
  });
});
