/**
 * Library ops — ISBN/holds/barcode/OPAC/fines (Wave 9 / G-916).
 *
 * Ungated: catalog, OPAC, circulation, holds, overdues, and fines pages render.
 * Gated (E2E_BACKEND_READY): hold → copy returned → hold ready → checkout by
 * barcode → overdue → assess fine → mark paid; tenant B cannot see tenant A.
 */
import { expect, test, type Page } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
const STUDENT_A = '00000000-0000-4000-8000-000000000099';
const STUDENT_HOLD = '00000000-0000-4000-8000-000000000094';

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

async function hydrated(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await expect(el).toHaveAttribute('data-hydrated', 'true', { timeout: 20_000 });
  return el;
}

test.describe('Library ops — pages render (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/library renders catalog actions', async ({ page }) => {
    await page.goto('/library', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('library-item-form')).toBeVisible();
    await hydrated(page, 'library-item-form');
  });

  test('/library/opac renders the read-only search', async ({ page }) => {
    await page.goto('/library/opac', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /opac/i })).toBeVisible();
    await expect(page.getByTestId('library-opac-form')).toBeVisible();
  });

  test('/library/circulation exposes barcode scan fields', async ({ page }) => {
    await page.goto('/library/circulation', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /circulation/i })).toBeVisible();
    await expect(page.getByTestId('library-checkout-barcode')).toBeVisible();
    await expect(page.getByTestId('library-return-barcode')).toBeVisible();
  });

  test('/library/holds and /library/fines render', async ({ page }) => {
    await page.goto('/library/holds', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /holds/i })).toBeVisible();
    await page.goto('/library/fines', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /fines/i })).toBeVisible();
  });
});

test.describe('Library ops — live chain (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('hold → return → ready → barcode checkout → overdue fine paid', async ({
    page,
    request,
  }) => {
    const title = `Hold Book ${stamp()}`;
    const created = await request.post(`${GATEWAY_URL}/api/v1/library/items`, {
      headers: headers(),
      data: { title, copies: 1, author: 'E2E' },
    });
    expect(created.status(), await created.text()).toBe(201);
    const item = await created.json();

    const detail = await request.get(`${GATEWAY_URL}/api/v1/library/items/${item.id}`, {
      headers: headers(),
    });
    expect(detail.status()).toBe(200);
    const body = await detail.json();
    const barcode = body.copyList[0].barcode as string;
    expect(barcode).toBeTruthy();

    const loanOut = await request.post(`${GATEWAY_URL}/api/v1/library/circulation/checkout`, {
      headers: headers(),
      data: { itemId: item.id, studentId: STUDENT_A },
    });
    expect(loanOut.status(), await loanOut.text()).toBe(201);

    const hold = await request.post(`${GATEWAY_URL}/api/v1/library/holds`, {
      headers: headers(),
      data: { itemId: item.id, studentId: STUDENT_HOLD, patronUserId: 'patron-hold' },
    });
    expect(hold.status(), await hold.text()).toBe(201);
    expect((await hold.json()).status).toBe('queued');

    const returned = await request.post(`${GATEWAY_URL}/api/v1/library/circulation/return-barcode`, {
      headers: headers(),
      data: { barcode },
    });
    expect(returned.status(), await returned.text()).toBe(200);

    const holds = await request.get(
      `${GATEWAY_URL}/api/v1/library/holds?itemId=${item.id}`,
      { headers: headers() },
    );
    expect(holds.status()).toBe(200);
    const ready = (await holds.json()).data.find((h: { studentId: string }) => h.studentId === STUDENT_HOLD);
    expect(ready.status).toBe('ready');

    const checkoutReady = await request.post(`${GATEWAY_URL}/api/v1/library/circulation/checkout`, {
      headers: headers(),
      data: { barcode, studentId: STUDENT_HOLD, patronUserId: 'patron-hold' },
    });
    expect(checkoutReady.status(), await checkoutReady.text()).toBe(201);

    const overdueItem = await request.post(`${GATEWAY_URL}/api/v1/library/items`, {
      headers: headers(),
      data: { title: `Overdue ${stamp()}`, copies: 1 },
    });
    expect(overdueItem.status()).toBe(201);
    const overdueBody = await overdueItem.json();
    const overdueLoan = await request.post(`${GATEWAY_URL}/api/v1/library/circulation/checkout`, {
      headers: headers(),
      data: {
        itemId: overdueBody.id,
        studentId: STUDENT_A,
        dueAt: '2020-01-01T00:00:00.000Z',
      },
    });
    expect(overdueLoan.status(), await overdueLoan.text()).toBe(201);
    const overdue = await overdueLoan.json();

    const assessed = await request.post(`${GATEWAY_URL}/api/v1/library/fines/assess`, {
      headers: headers(),
      data: { loanId: overdue.id },
    });
    expect(assessed.status(), await assessed.text()).toBe(201);
    const fine = await assessed.json();
    expect(fine.amountCents).toBeGreaterThan(0);
    expect(fine.invoice?.id).toBeTruthy();

    const invoices = await request.get(`${GATEWAY_URL}/api/v1/fees/invoices`, {
      headers: headers(),
    });
    expect(invoices.status()).toBe(200);
    const invoiceRows = (await invoices.json()).data as Array<{ id: string }>;
    expect(invoiceRows.some((row) => row.id === fine.invoice.id)).toBe(true);

    const paid = await request.post(`${GATEWAY_URL}/api/v1/library/fines/${fine.fine.id}/pay`, {
      headers: headers(),
    });
    expect(paid.status(), await paid.text()).toBe(200);
    expect((await paid.json()).status).toBe('paid');

    const opac = await request.get(
      `${GATEWAY_URL}/api/v1/library/opac/search?q=${encodeURIComponent(title)}`,
      { headers: headers() },
    );
    expect(opac.status()).toBe(200);
    expect((await opac.json()).data.some((row: { title: string }) => row.title === title)).toBe(true);

    const isolated = await request.get(
      `${GATEWAY_URL}/api/v1/library/opac/search?q=${encodeURIComponent(title)}`,
      { headers: headers(TENANT_B) },
    );
    expect(isolated.status()).toBe(200);
    expect((await isolated.json()).data).toEqual([]);

    await page.goto(`/library/${item.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  });
});
