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

test.describe('Audit integrity — pages render (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/audit-logs renders with the DSAR link', async ({ page }) => {
    await page.goto('/audit-logs', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Audit logs' })).toBeVisible();
    await expect(page.getByTestId('dsar-link')).toBeVisible();
  });

  test('/audit-logs/dsar renders the lookup form', async ({ page }) => {
    await page.goto('/audit-logs/dsar', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'DSAR export' })).toBeVisible();
    await expect(page.getByTestId('dsar-subject')).toBeVisible();
  });
});

test.describe('Audit integrity — live (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
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
    await expect(page.getByTestId('chain-integrity')).toHaveAttribute('data-valid', 'true');
  });

  test('DSAR page builds a package for the actor and the download proxy streams JSON', async ({
    page,
    request,
  }) => {
    const subject = `dsar-${Date.now().toString(36)}`;
    const created = await request.post(`${GATEWAY_URL}/api/v1/audit-logs`, {
      headers: headers(),
      data: {
        entityType: 'staff',
        entityId: subject,
        operation: 'CREATE',
        beforeValues: null,
        afterValues: { name: 'Probe' },
      },
    });
    expect(created.status(), await created.text()).toBe(201);

    await page.goto('/audit-logs/dsar', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('dsar-subject').fill(subject);
    await page.getByTestId('dsar-run').click();
    await expect(page.getByTestId('dsar-package')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('dsar-row')).toHaveCount(1);

    const download = await page.request.get(`/api/audit-logs/dsar/${subject}`);
    expect(download.status()).toBe(200);
    expect(download.headers()['content-disposition']).toContain(`dsar-${subject}.json`);
    const pack = await download.json();
    expect(pack.subjectId).toBe(subject);
    expect(pack.entryCount).toBe(1);
  });

  test('retention policy saves from the UI and is readable via API', async ({ page, request }) => {
    await page.goto('/audit-logs', { waitUntil: 'domcontentloaded' });
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
