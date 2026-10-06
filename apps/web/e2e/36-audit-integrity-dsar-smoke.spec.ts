/**
 * Audit trail integrity + DSAR + retention (Wave 9 / G-913).
 *
 * Ungated: /audit-logs and /audit-logs/dsar render.
 * Gated (E2E_BACKEND_READY): a mutation lands in the hash chain, the chain
 * verifies clean via UI + API, the DSAR page builds a package for the actor
 * and the JSON download proxy streams it, and the retention policy saves.
 */
import { expect, test } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
/** `/audit-logs` maps to the synthetic `platform` resource (G-727). */
const PLATFORM_ROLES = [
  { roleId: 'platform_admin', roleName: 'Platform Admin', areaId: null },
  { roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null },
];

function headers(tenantId = TENANT_A) {
  const token = createSignedJwt({
    sub: 'e2e-admin',
    email: 'admin@tenant-a.test',
    displayName: 'E2E Admin',
    tenantId,
    roles: PLATFORM_ROLES,
    institutions: [],
  });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-ID': tenantId,
  };
}

test.describe('Audit integrity — pages render (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page, { roles: PLATFORM_ROLES });
  });

  test('/audit-logs renders with the DSAR link', async ({ page }) => {
    await page.goto('/audit-logs', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Audit logs' })).toBeVisible();
    // `next start` briefly streams an unhydrated duplicate outside <main>
    // during the client swap, sometimes more than once before settling.
    // `toPass` retries the whole count+visibility pair rather than assuming
    // one oscillation, since `toBeVisible()` alone throws immediately on a
    // strict-mode (multiple-match) violation.
    const dsarLink = page.getByTestId('dsar-link');
    await expect(async () => {
      await expect(dsarLink).toHaveCount(1, { timeout: 2_000 });
      await expect(dsarLink).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  });

  test('/audit-logs/dsar renders the lookup form', async ({ page }) => {
    await page.goto('/audit-logs/dsar', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'DSAR export' })).toBeVisible();
    const dsarSubject = page.getByTestId('dsar-subject');
    await expect(async () => {
      await expect(dsarSubject).toHaveCount(1, { timeout: 2_000 });
      await expect(dsarSubject).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  });
});

test.describe('Audit integrity — live (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page, { roles: PLATFORM_ROLES });
  });

  test('a recorded entry extends the chain and verification stays valid', async ({
    page,
    request,
  }) => {
    const entityId = `e2e-${Date.now().toString(36)}`;
    const created = await request.post(`${GATEWAY_URL}/api/v1/audit-logs`, {
      headers: headers(),
      data: {
        entityType: 'student',
        entityId,
        operation: 'UPDATE',
        beforeValues: { name: 'A' },
        afterValues: { name: 'B' },
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const entry = await created.json();
    expect(typeof entry.entryHash).toBe('string');
    expect(entry.chainSeq).toBeGreaterThan(0);

    const verify = await request.get(`${GATEWAY_URL}/api/v1/audit-logs/chain/verify`, {
      headers: headers(),
    });
    expect(verify.status()).toBe(200);
    const body = await verify.json();
    expect(body.valid).toBe(true);
    expect(body.headSeq).toBeGreaterThanOrEqual(entry.chainSeq);

    await page.goto('/audit-logs', { waitUntil: 'domcontentloaded' });
    // PRC-M085: verification is an explicit action, not part of page load.
    // Wait for hydration so the click reaches the handler (not the SSR markup).
    await expect(page.getByTestId('chain-verify')).toHaveAttribute('data-hydrated', 'true');
    await page.getByTestId('chain-verify').click();
    await expect(page.getByTestId('chain-integrity')).toHaveAttribute('data-valid', 'true');
  });

  test('DSAR page builds a package for the actor and the download proxy streams JSON', async ({
    page,
    request,
  }) => {
    const lastName = `Dsar${Date.now().toString(36)}`;
    const createdStudent = await request.post(`${GATEWAY_URL}/api/v1/students`, {
      headers: headers(),
      data: {
        firstName: 'Audit',
        lastName,
        dateOfBirth: '2010-05-05',
        gender: 'female',
      },
    });
    expect(createdStudent.status(), await createdStudent.text()).toBe(201);
    const subject = (await createdStudent.json()).id as string;
    const created = await request.post(`${GATEWAY_URL}/api/v1/audit-logs`, {
      headers: headers(),
      data: {
        entityType: 'student',
        entityId: subject,
        operation: 'CREATE',
        beforeValues: null,
        afterValues: { name: 'Probe' },
      },
    });
    expect(created.status(), await created.text()).toBe(201);

    await page.goto('/audit-logs/dsar', { waitUntil: 'domcontentloaded' });
    // PRC-M084: "Build package" is a client-side server action. Clicking before
    // hydration falls back to a native GET that only pre-fills the field, so
    // wait for the form to hydrate (count+attribute retried together because
    // `next start` can briefly stream an unhydrated duplicate).
    const dsarForm = page.getByTestId('dsar-form');
    await expect(async () => {
      await expect(dsarForm).toHaveCount(1, { timeout: 2_000 });
      await expect(dsarForm).toHaveAttribute('data-hydrated', 'true', { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    // Free-text subject field (any actor id). Directory names are suggestions only.
    await page.getByTestId('dsar-subject-input').fill(subject);
    await page.getByTestId('dsar-run').click();
    await expect(page.getByTestId('dsar-package')).toBeVisible({ timeout: 15_000 });
    // PRC-M013: a subject's DSAR includes EVERY audit row about that subject.
    // `resolveAuditEntityId` attributes the gateway's post-hoc student-create
    // row to the new student id, so the package holds that row plus the probe.
    await expect(page.getByTestId('dsar-row')).toHaveCount(2);

    // PRC-M084: the download saves the package already built (no GET export
    // route), and the build itself was audited.
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('dsar-download').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`dsar-${subject}.json`);
    // A reload must not export again: the package is gone until rebuilt.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('dsar-package')).toHaveCount(0);
  });

  test('retention policy saves from the UI and is readable via API', async ({ page, request }) => {
    await page.goto('/audit-logs', { waitUntil: 'domcontentloaded' });
    // `next start` briefly streams an unhydrated duplicate outside <main>
    // during the client swap, sometimes more than once before settling.
    // `toPass` retries the whole count+attribute pair rather than assuming
    // one oscillation, since `toHaveAttribute` alone does not retry past a
    // strict-mode (multiple-match) violation.
    const retentionForm = page.getByTestId('retention-form');
    await expect(async () => {
      await expect(retentionForm).toHaveCount(1, { timeout: 2_000 });
      await expect(retentionForm).toHaveAttribute('data-hydrated', 'true', { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await page.getByLabel('Retain for (months)').fill('36');
    await page.getByTestId('save-retention').click();
    await expect(page.getByTestId('retention-feedback')).toHaveText(/saved/i, { timeout: 15_000 });

    const res = await request.get(`${GATEWAY_URL}/api/v1/audit-logs/retention`, {
      headers: headers(),
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).retentionMonths).toBe(36);
  });
});
