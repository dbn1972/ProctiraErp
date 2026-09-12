/**
 * Fee structures — class × category × term, bulk invoice, concession, pay,
 * refund, dues report (Wave 9 / G-903).
 *
 * Ungated: the fees hub, structures, and reports pages render (no crash).
 * Gated (E2E_BACKEND_READY): live API structure → bulk invoice → concession →
 * pay → refund → report, plus tenant B isolation.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
/** Seeded by tools/e2e/seed-e2e-tenants.sql. */
const INSTITUTION_A = 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';
const STUDENT_A = '00000000-0000-4000-8000-0000000000aa';

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

async function createStructure(
  request: APIRequestContext,
  input: { name: string; category: string; amountCents: number; classId?: string },
): Promise<{ id: string; code: string; amountCents: number }> {
  const code = `FS-${stamp()}`;
  const res = await request.post(`${GATEWAY_URL}/api/v1/fees/structures`, {
    headers: headers(),
    data: {
      name: input.name,
      code,
      category: input.category,
      amountCents: input.amountCents,
      currency: 'INR',
      institutionId: INSTITUTION_A,
      classId: input.classId,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  return { id: body.id as string, code, amountCents: body.amountCents as number };
}

test.describe('Fee structures — pages render (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/fees renders with the structures and reports actions', async ({ page }) => {
    await page.goto('/fees', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('open-structures')).toBeVisible();
    await expect(page.getByTestId('open-reports')).toBeVisible();
    await expect(page.getByTestId('open-reconciliation')).toBeVisible();
    await expect(page.getByTestId('open-scholarship-netting')).toBeVisible();
    await expect(page.getByTestId('open-dunning')).toBeVisible();
  });

  test('/fees/structures renders with the New structure action', async ({ page }) => {
    await page.goto('/fees/structures', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /fee structures/i })).toBeVisible();
    await expect(page.getByTestId('new-structure')).toBeVisible();
  });

  test('/fees/reports renders the dues summary', async ({ page }) => {
    await page.goto('/fees/reports', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /fee reports/i })).toBeVisible();
    await expect(page.getByTestId('download-dues-csv')).toBeVisible();
    await expect(page.getByTestId('open-reconciliation-from-reports')).toBeVisible();
  });

  test('/fees/reconciliation renders import and audit empty state', async ({ page }) => {
    await page.goto('/fees/reconciliation', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /reconciliation/i })).toBeVisible();
    await expect(page.getByTestId('recon-import-form')).toBeVisible();
    await expect(page.getByTestId('submit-recon')).toBeVisible();
  });

  test('/fees/scholarship-netting renders the apply form', async ({ page }) => {
    await page.goto('/fees/scholarship-netting', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /scholarship netting/i })).toBeVisible();
    await expect(page.getByTestId('scholarship-netting-form')).toBeVisible();
    await expect(page.getByTestId('submit-scholarship-netting')).toBeVisible();
  });

  test('/fees/dunning renders the reminder console', async ({ page }) => {
    await page.goto('/fees/dunning', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /dunning \/ reminders/i })).toBeVisible();
    await expect(page.getByTestId('dunning-console')).toBeVisible();
    await expect(page.getByTestId('dunning-sandbox-banner')).toBeVisible();
  });
});

test.describe('Fee structures — live chain (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('structure → bulk invoice → concession → pay → refund → report', async ({
    page,
    request,
  }) => {
    const structure = await createStructure(request, {
      name: `E2E Tuition ${stamp()}`,
      category: 'tuition',
      amountCents: 100_000,
    });

    const instalments = await request.post(
      `${GATEWAY_URL}/api/v1/fees/structures/${structure.id}/instalments`,
      { headers: headers(), data: { partCount: 4 } },
    );
    expect(instalments.status(), await instalments.text()).toBe(201);
    const parts = ((await instalments.json()).data as Array<{ amountCents: number }>).map(
      (row) => row.amountCents,
    );
    expect(parts.reduce((sum, n) => sum + n, 0)).toBe(100_000);

    await page.goto('/fees/structures', { waitUntil: 'domcontentloaded' });
    const row = page.locator(
      `[data-testid="fee-structure-row"][data-structure-code="${structure.code}"]`,
    );
    await expect(row).toBeVisible();

    await expect(page.getByTestId('bulk-invoice-form')).toHaveAttribute('data-hydrated', 'true', {
      timeout: 20_000,
    });
    // The select defaults to the first structure in the list; other specs and
    // earlier runs leave structures behind, so pin ours explicitly.
    await page.locator('#bi-structure').selectOption(structure.id);
    await page.locator('#bi-students').fill(STUDENT_A);
    await page.getByTestId('submit-bulk-invoice').click();
    await expect(page.getByTestId('bulk-invoice-result')).toHaveAttribute('data-created', '1', {
      timeout: 20_000,
    });

    const listed = await request.get(`${GATEWAY_URL}/api/v1/fees/invoices`, { headers: headers() });
    expect(listed.status()).toBe(200);
    const invoices = (
      (await listed.json()).data as Array<{
        id: string;
        structureId: string;
        studentId: string;
        amountCents: number;
        invoiceNumber: string;
        status: string;
      }>
    ).filter((inv) => inv.structureId === structure.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.studentId).toBe(STUDENT_A);
    expect(invoices[0]!.amountCents).toBe(100_000);
    const invoiceId = invoices[0]!.id;
    const invoiceNumber = invoices[0]!.invoiceNumber;

    const again = await request.post(
      `${GATEWAY_URL}/api/v1/fees/structures/${structure.id}/bulk-invoice`,
      { headers: headers(), data: { studentIds: [STUDENT_A] } },
    );
    expect(again.status(), await again.text()).toBe(201);
    expect(await again.json()).toMatchObject({ skipped: [STUDENT_A], created: [] });

    const concession = await request.post(`${GATEWAY_URL}/api/v1/fees/concessions`, {
      headers: headers(),
      data: {
        studentId: STUDENT_A,
        structureId: structure.id,
        invoiceId,
        kind: 'percent',
        percent: 20,
        reason: 'E2E sibling discount',
      },
    });
    expect(concession.status(), await concession.text()).toBe(201);
    expect(await concession.json()).toMatchObject({ discountCents: 20_000 });

    const pay = await request.post(`${GATEWAY_URL}/api/v1/fees/invoices/${invoiceId}/pay`, {
      headers: headers(),
      data: { method: 'sandbox' },
    });
    expect(pay.status(), await pay.text()).toBe(201);
    const paidBody = await pay.json();
    expect(paidBody.invoice.status).toBe('paid');
    expect(paidBody.payment.amountCents).toBe(80_000);

    const tooMuch = await request.post(`${GATEWAY_URL}/api/v1/fees/invoices/${invoiceId}/refund`, {
      headers: headers(),
      data: { amountCents: 80_001, reason: 'too much' },
    });
    expect(tooMuch.status(), await tooMuch.text()).toBe(422); // BusinessRuleError: refund exceeds paid

    const refund = await request.post(`${GATEWAY_URL}/api/v1/fees/invoices/${invoiceId}/refund`, {
      headers: headers(),
      data: { amountCents: 10_000, reason: 'E2E overcharge' },
    });
    expect(refund.status(), await refund.text()).toBe(201);

    const report = await request.get(`${GATEWAY_URL}/api/v1/fees/reports/dues`, {
      headers: headers(),
    });
    expect(report.status()).toBe(200);
    const body = await report.json();
    expect(body.byStatus.some((row: { status: string }) => row.status === 'paid')).toBe(true);

    const recon = await request.post(`${GATEWAY_URL}/api/v1/fees/reconciliation/import`, {
      headers: headers(),
      data: { csv: `invoiceNumber,amountCents\n${invoiceNumber},80000\nMISSING,1` },
    });
    expect(recon.status(), await recon.text()).toBe(201);
    const reconBody = await recon.json();
    expect(reconBody.matched).toHaveLength(1);
    expect(reconBody.unmatched).toHaveLength(1);

    const batches = await request.get(`${GATEWAY_URL}/api/v1/fees/reconciliation/batches`, {
      headers: headers(),
    });
    expect(batches.status()).toBe(200);
    const batchList = (await batches.json()).data as Array<{ id: string }>;
    expect(batchList.some((row) => row.id === reconBody.batch.id)).toBe(true);

    const rowsRes = await request.get(
      `${GATEWAY_URL}/api/v1/fees/reconciliation/batches/${reconBody.batch.id}/rows`,
      { headers: headers() },
    );
    expect(rowsRes.status()).toBe(200);
    const rows = (await rowsRes.json()).data as Array<{
      id: string;
      matched: boolean;
      exceptionStatus: string;
    }>;
    const exception = rows.find((row) => !row.matched);
    expect(exception?.exceptionStatus).toBe('open');

    const resolve = await request.post(
      `${GATEWAY_URL}/api/v1/fees/reconciliation/rows/${exception!.id}/resolve`,
      {
        headers: headers(),
        data: { status: 'resolved', resolutionNote: 'E2E write-off' },
      },
    );
    expect(resolve.status(), await resolve.text()).toBe(200);
    expect(await resolve.json()).toMatchObject({
      exceptionStatus: 'resolved',
      resolutionNote: 'E2E write-off',
    });

    await page.goto('/fees/reconciliation', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('recon-import-form')).toBeVisible();
    await expect(page.getByTestId('recon-batch-list')).toBeVisible();

    await page.goto('/fees/reports', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('dues-status-row').first()).toBeVisible();
  });

  test('cross-tenant: tenant B cannot read or write tenant A structures', async ({ request }) => {
    const structure = await createStructure(request, {
      name: `E2E Isolated ${stamp()}`,
      category: 'lab',
      amountCents: 5_000,
    });

    const foreignList = await request.get(`${GATEWAY_URL}/api/v1/fees/structures`, {
      headers: headers(TENANT_B),
    });
    expect(foreignList.status()).toBe(200);
    const codes = ((await foreignList.json()).data as Array<{ id: string }>).map((row) => row.id);
    expect(codes).not.toContain(structure.id);

    const foreignInstalments = await request.post(
      `${GATEWAY_URL}/api/v1/fees/structures/${structure.id}/instalments`,
      { headers: headers(TENANT_B), data: { partCount: 2 } },
    );
    expect([400, 404]).toContain(foreignInstalments.status());

    const foreignBulk = await request.post(
      `${GATEWAY_URL}/api/v1/fees/structures/${structure.id}/bulk-invoice`,
      { headers: headers(TENANT_B), data: { studentIds: [STUDENT_A] } },
    );
    expect([400, 404]).toContain(foreignBulk.status());
  });

  test('scholarship netting credits invoice and denies cross-tenant', async ({ request }) => {
    const structure = await createStructure(request, {
      name: `E2E Net ${stamp()}`,
      category: 'tuition',
      amountCents: 10_000,
    });
    const bulk = await request.post(
      `${GATEWAY_URL}/api/v1/fees/structures/${structure.id}/bulk-invoice`,
      { headers: headers(), data: { studentIds: [STUDENT_A] } },
    );
    expect(bulk.status(), await bulk.text()).toBe(200);
    const invoiceId = ((await bulk.json()).created as Array<{ id: string }>)[0]?.id;
    expect(invoiceId).toBeTruthy();

    const disbursementId = `e2e-disb-${stamp()}`;
    const net = await request.post(`${GATEWAY_URL}/api/v1/fees/scholarships/net`, {
      headers: headers(),
      data: {
        studentId: STUDENT_A,
        disbursementId,
        amountCents: 2500,
        invoiceId,
      },
    });
    expect(net.status(), await net.text()).toBe(200);
    const body = await net.json();
    expect(body.idempotent).toBe(false);
    expect(body.discountCents).toBe(2500);
    expect(body.invoice?.amountCents).toBe(7500);

    const replay = await request.post(`${GATEWAY_URL}/api/v1/fees/scholarships/net`, {
      headers: headers(),
      data: {
        studentId: STUDENT_A,
        disbursementId,
        amountCents: 2500,
      },
    });
    expect(replay.status()).toBe(200);
    expect((await replay.json()).idempotent).toBe(true);

    const foreignNet = await request.post(`${GATEWAY_URL}/api/v1/fees/scholarships/net`, {
      headers: headers(TENANT_B),
      data: {
        studentId: STUDENT_A,
        disbursementId: `foreign-${stamp()}`,
        amountCents: 100,
        invoiceId,
      },
    });
    // Tenant B must not credit tenant A invoice; either no matching invoice (reserved) or deny.
    if (foreignNet.status() === 200) {
      const foreignBody = await foreignNet.json();
      expect(foreignBody.invoice?.id ?? null).not.toBe(invoiceId);
    } else {
      expect([400, 403, 404]).toContain(foreignNet.status());
    }
  });
});
