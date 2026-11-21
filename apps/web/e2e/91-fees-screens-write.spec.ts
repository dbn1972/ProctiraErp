import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import {
  BACKEND_READY,
  createStudent,
  feesAdmin,
  hydrated,
  invoicesFor,
  markDisbursementPaidUndelivered,
  newTag,
  openAs,
  pageOf,
  pick,
  ready,
  scheduledDisbursement,
  send,
  settle,
  structureInvoice,
  utcDate,
  type FeeInvoice,
  type FeeReceipt,
  type Persona,
} from './fixtures/fees-screens';

/**
 * Fees module — every write screen saves through its own form (screen → API → DB).
 *
 * Each test seeds what its form needs through the gateway with a unique tag, submits the
 * screen's own form as a tenant administrator, confirms the result on screen (after a
 * reload where the screen re-reads the API), and reads the row back through the API with
 * its exact paise.
 *
 * Money cases with paisa: ₹1,999.99 (float 1999.99 × 100 must be 199999), ₹1,050.05 paid as
 * ₹500.05 + ₹550.00 and refunded as ₹1,000.00 + ₹50.05, ₹1,000.00 split into 3 instalments
 * (33334 + 33333 + 33333), reconciliation amounts typed in rupees (₹999.99 → 99999 paise) and
 * a ₹250.50 scholarship credit on ₹1,000.00 (→ ₹749.50).
 *
 * Known open defects are not exercised (defects.md): netting against an ad-hoc or plan
 * invoice, or with a scholarship above the open amount (F-D1, F-D2). The netting test uses
 * a structure invoice and a smaller scholarship, which works today.
 */

/**
 * Row buttons hydrate after the server page streams in. Under host load (nightly shards,
 * parallel module runs) that has taken longer than the 20 s CI expect timeout, so the
 * waits that only gate on hydration get 45 s.
 */
const SLOW_UI = { timeout: 45_000 };

function listItem(page: Page, testId: string, text: string): Locator {
  return page.getByTestId(testId).filter({ hasText: text });
}

/** Receipts of `invoiceId`, walking the newest-first staff receipt pages until `expected` are found. */
async function receiptsFor(
  request: APIRequestContext,
  p: Persona,
  invoiceId: string,
  expected: number,
): Promise<FeeReceipt[]> {
  const found: FeeReceipt[] = [];
  for (let page = 1; page <= 400 && found.length < expected; page += 1) {
    const body = await send<{ data: FeeReceipt[]; meta: { totalPages: number } }>(
      request,
      p,
      'GET',
      `/fees/receipts?page=${page}&pageSize=100`,
    );
    found.push(...body.data.filter((r) => r.invoiceId === invoiceId));
    if (page >= body.meta.totalPages) break;
  }
  return found;
}

interface LedgerEntry {
  account: string;
  side: string;
  amountCents: number;
  memo: string | null;
  paymentId: string | null;
}

async function ledger(request: APIRequestContext, p: Persona, invoiceId: string) {
  return (
    await send<{ data: LedgerEntry[] }>(request, p, 'GET', `/fees/invoices/${invoiceId}/ledger`)
  ).data;
}

/** Open `/fees/invoices` at the page holding `invoiceId` and return its row. */
async function openInvoiceRow(
  page: Page,
  request: APIRequestContext,
  p: Persona,
  invoice: FeeInvoice,
): Promise<Locator> {
  const { page: n } = await pageOf(request, p, '/fees/invoices', invoice.id);
  await page.goto(`/fees/invoices?page=${n}`, { waitUntil: 'domcontentloaded' });
  const row = listItem(page, 'fee-invoice-row', invoice.invoiceNumber);
  await expect(row).toHaveCount(1, SLOW_UI);
  return row;
}

/** Record one staff payment through the row's "Record payment" dialog. */
async function recordPayment(
  page: Page,
  row: Locator,
  input: { method: 'cash' | 'upi'; amount: string; reference: string },
): Promise<Locator> {
  const open = row.getByTestId('staff-pay-invoice');
  await expect(open).toHaveAttribute('data-hydrated', 'true', SLOW_UI);
  await open.click();
  const dialog = page.getByTestId('staff-pay-confirm');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('staff-pay-method').selectOption(input.method);
  await dialog.getByTestId('staff-pay-amount').fill(input.amount);
  await dialog.getByTestId('staff-pay-reference').fill(input.reference);
  await page.getByTestId('staff-pay-confirm-confirm').click();
  return dialog;
}

/** Submit the row's refund dialog and confirm it; returns the refund form. */
async function submitRefund(page: Page, row: Locator, amount: string, reason: string) {
  const open = row.getByTestId('open-refund');
  if ((await page.getByTestId('refund-form').count()) === 0) {
    await expect(open).toHaveAttribute('data-hydrated', 'true', SLOW_UI);
    await open.click();
  }
  const form = await hydrated(page, 'refund-form');
  await form.locator('#refund-amount').fill(amount);
  await form.locator('#refund-reason').fill(reason);
  await form.getByTestId('submit-refund').click();
  await expect(page.getByTestId('refund-confirm')).toContainText(
    `This posts INR ${Number(amount).toFixed(2)} back to the payer. Reason: ${reason}`,
  );
  await page.getByTestId('refund-confirm-confirm').click();
  return form;
}

test.describe('Fees screens — form saves (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires live gateway (E2E_BACKEND_READY)');

  test('/fees/plans: the create-plan form saves a plan with exact paise', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = feesAdmin(`fe-w-admin-${tag}`);
    await openAs(page, admin);
    const name = `FE new plan ${tag}`;
    const code = `FE-NP${tag}`;
    await page.goto('/fees/plans', { waitUntil: 'domcontentloaded' });
    await (await ready(page.locator('#plan-name'))).fill(name);
    await page.locator('#plan-code').fill(code);
    await page.locator('#plan-amount').fill('1999.99');
    await page.locator('#plan-frequency').selectOption('month');
    await page.locator('#plan-description').fill(`FE monthly bus ${tag}`);
    await page.getByRole('button', { name: 'Create plan' }).click();

    const row = listItem(page, 'fee-plan-row', name);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`${name} (${code})`);
    await expect(row).toContainText('₹1,999.99 · Month · Active');
    await expect(page.locator('#plan-name')).toHaveValue('');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(listItem(page, 'fee-plan-row', name)).toContainText('₹1,999.99 · Month · Active');

    const plans = await send<{ data: Array<Record<string, unknown>> }>(
      request,
      admin,
      'GET',
      '/fees/plans',
    );
    expect(plans.data.filter((p) => p.code === code)).toEqual([
      expect.objectContaining({
        name,
        amountCents: 199_999,
        currency: 'INR',
        frequency: 'month',
        status: 'active',
        description: `FE monthly bus ${tag}`,
      }),
    ]);
  });

  test('/fees/invoices: issue, record payments and refund through the screen forms', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const admin = feesAdmin(`fe-w-admin-${tag}`);
    const student = await createStudent(request, admin, tag);
    const planName = `FE issue plan ${tag}`;
    const plan = await send<{ id: string }>(request, admin, 'POST', '/fees/plans', {
      name: planName,
      code: `FE-IP${tag}`,
      amountCents: 123_456,
      frequency: 'once',
    });
    await openAs(page, admin);

    // Issue from a plan.
    await page.goto('/fees/invoices', { waitUntil: 'domcontentloaded' });
    await ready(page.locator('#invoice-plan'));
    await pick(page, 'invoice-student', student.label, student.id);
    await page.locator('#invoice-plan').selectOption(plan.id);
    await page.getByRole('button', { name: 'Issue invoice' }).click();
    await expect.poll(async () => (await invoicesFor(request, admin, student.id)).length).toBe(1);
    const [planInvoice] = await invoicesFor(request, admin, student.id);
    expect(planInvoice).toMatchObject({
      planId: plan.id,
      title: planName,
      amountCents: 123_456,
      currency: 'INR',
      status: 'open',
    });
    await expect(listItem(page, 'fee-invoice-row', planInvoice!.invoiceNumber)).toContainText(
      `₹1,234.56 · ${student.label} · Open · ${planInvoice!.invoiceNumber} · ${planName}`,
    );

    // Issue ad hoc.
    const title = `FE adhoc ${tag}`;
    await ready(page.locator('#invoice-title'));
    await pick(page, 'invoice-student', student.label, student.id);
    await page.locator('#invoice-title').fill(title);
    await page.locator('#invoice-amount').fill('1050.05');
    await page.getByRole('button', { name: 'Issue invoice' }).click();
    await expect.poll(async () => (await invoicesFor(request, admin, student.id)).length).toBe(2);
    const adhoc = (await invoicesFor(request, admin, student.id)).find((i) => i.title === title)!;
    expect(adhoc).toMatchObject({ planId: null, amountCents: 105_005, status: 'open' });

    let row = await openInvoiceRow(page, request, admin, adhoc);
    await expect(row).toContainText(title);
    await expect(row).toContainText(`₹1,050.05 · ${student.label} · Open · ${adhoc.invoiceNumber}`);

    // Partial payment: the invoice stays open.
    let dialog = await recordPayment(page, row, {
      method: 'cash',
      amount: '500.05',
      reference: `FE-RB-${tag}`,
    });
    await expect(dialog).toHaveCount(0);
    row = await openInvoiceRow(page, request, admin, adhoc);
    await expect(row).toContainText(`₹1,050.05 · ${student.label} · Open`);

    // Paying more than the ₹550.00 still owed is refused on screen and records nothing.
    dialog = await recordPayment(page, row, {
      method: 'upi',
      amount: '550.01',
      reference: `FE-UPI-X${tag}`,
    });
    await expect(dialog.getByRole('alert')).toContainText('The fee change could not be saved.');
    await page.getByTestId('staff-pay-confirm-cancel').click();
    expect(await receiptsFor(request, admin, adhoc.id, 2)).toHaveLength(1);

    // The exact remainder closes the invoice.
    dialog = await recordPayment(page, row, {
      method: 'upi',
      amount: '550.00',
      reference: `FE-UPI-${tag}`,
    });
    await expect(dialog).toHaveCount(0);
    row = await openInvoiceRow(page, request, admin, adhoc);
    await expect(row).toContainText(`₹1,050.05 · ${student.label} · Paid · ${adhoc.invoiceNumber}`);
    await expect(row.getByTestId('staff-pay-invoice')).toHaveCount(0);
    const receipts = await receiptsFor(request, admin, adhoc.id, 2);
    expect(receipts.map((r) => r.amountCents).sort((a, b) => a - b)).toEqual([50_005, 55_000]);

    // Both receipts are on the receipts screen with the invoice number.
    for (const [receipt, amount] of receipts.map(
      (r) => [r, r.amountCents === 50_005 ? '₹500.05' : '₹550.00'] as const,
    )) {
      const { page: n } = await pageOf(request, admin, '/fees/receipts', receipt.id);
      await page.goto(`/fees/receipts?page=${n}`, { waitUntil: 'domcontentloaded' });
      await expect(listItem(page, 'fee-receipt-row', receipt.receiptNumber)).toContainText(
        `${amount} · ${adhoc.invoiceNumber} · `,
      );
    }

    // Refunds: the form starts at the invoice amount; a refund above what is left is refused.
    row = await openInvoiceRow(page, request, admin, adhoc);
    await expect(row.getByTestId('open-refund')).toHaveAttribute('data-hydrated', 'true', SLOW_UI);
    await row.getByTestId('open-refund').click();
    await expect((await hydrated(page, 'refund-form')).locator('#refund-amount')).toHaveValue(
      '1050.05',
    );
    let form = await submitRefund(page, row, '1000.00', `FE overcharge ${tag}`);
    await expect(form).toHaveCount(0);
    form = await submitRefund(page, row, '50.06', `FE too much ${tag}`);
    await expect(form.getByRole('alert')).toContainText('The fee change could not be saved.');
    form = await submitRefund(page, row, '50.05', `FE balance ${tag}`);
    await expect(form).toHaveCount(0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(listItem(page, 'fee-invoice-row', adhoc.invoiceNumber)).toContainText('Paid');

    const entries = await ledger(request, admin, adhoc.id);
    const refunds = entries.filter((e) => e.memo === 'refund posted' && e.account === 'cash');
    expect(refunds.map((e) => [e.side, e.amountCents])).toEqual(
      expect.arrayContaining([
        ['credit', 100_000],
        ['credit', 5_005],
      ]),
    );
    expect(refunds).toHaveLength(2);
  });

  test('/fees/invoices: the concession form records a pending concession (four-eyes)', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = feesAdmin(`fe-w-admin-${tag}`);
    const student = await createStudent(request, admin, tag);
    const { invoice } = await structureInvoice(request, admin, {
      name: `FE concession tuition ${tag}`,
      code: `FE-CS${tag}`,
      amountCents: 99_999,
      studentId: student.id,
    });
    await openAs(page, admin);
    let row = await openInvoiceRow(page, request, admin, invoice);
    await expect(row).toContainText(`₹999.99 · ${student.label} · Open`);
    await expect(row.getByTestId('open-concession')).toHaveAttribute(
      'data-hydrated',
      'true',
      SLOW_UI,
    );
    await row.getByTestId('open-concession').click();
    let form = await hydrated(page, 'concession-form');
    await form.locator('#concession-percent').fill('15');
    await form.locator('#concession-reason').fill(`FE sibling ${tag}`);
    await form.getByTestId('submit-concession').click();
    await expect(form).toHaveCount(0);

    // Pending until a second person approves: the invoice amount is unchanged.
    row = await openInvoiceRow(page, request, admin, invoice);
    await expect(row).toContainText(`₹999.99 · ${student.label} · Open`);
    expect((await invoicesFor(request, admin, student.id))[0]).toMatchObject({
      amountCents: 99_999,
    });

    // The concession was stored: a second one for the same invoice is refused on screen.
    await row.getByTestId('open-concession').click();
    form = await hydrated(page, 'concession-form');
    await form.locator('#concession-reason').fill(`FE again ${tag}`);
    await form.getByTestId('submit-concession').click();
    await expect(form.getByRole('alert')).toContainText('The fee change could not be saved.');
  });

  test('/fees/structures: create a structure and bulk-invoice a student through the forms', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const admin = feesAdmin(`fe-w-admin-${tag}`);
    const student = await createStudent(request, admin, tag);
    const name = `FE lab fee ${tag}`;
    const code = `FE-LB${tag}`;
    await openAs(page, admin);
    await page.goto('/fees/structures', { waitUntil: 'domcontentloaded' });
    await (await hydrated(page, 'new-structure')).click();
    const form = await hydrated(page, 'structure-form');
    await form.locator('#st-name').fill(name);
    await form.locator('#st-code').fill(code);
    await form.locator('#st-category').fill('lab');
    await form.locator('#st-term').fill(`T2-${tag}`);
    await form.locator('#st-amount').fill('1000.00');
    await form.locator('#st-parts').fill('3');
    await form.getByTestId('submit-structure').click();
    await expect(form).toHaveCount(0);

    const row = page.locator(`[data-testid="fee-structure-row"][data-structure-code="${code}"]`);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`${name} (${code})`);
    await expect(row).toContainText(`₹1,000.00 · lab · T2-${tag}`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(row).toContainText(`₹1,000.00 · lab · T2-${tag}`);

    const structures = await send<{
      data: Array<{ id: string; code: string; amountCents: number }>;
    }>(request, admin, 'GET', '/fees/structures');
    const structure = structures.data.find((s) => s.code === code)!;
    expect(structure).toMatchObject({ amountCents: 100_000, currency: 'INR', category: 'lab' });
    const parts = await send<{ data: Array<{ sequence: number; amountCents: number }> }>(
      request,
      admin,
      'GET',
      `/fees/structures/${structure.id}/instalments`,
    );
    expect(parts.data.map((p) => p.amountCents).reduce((a, b) => a + b, 0)).toBe(100_000);
    expect(parts.data.map((p) => p.amountCents).sort((a, b) => b - a)).toEqual([
      33_334, 33_333, 33_333,
    ]);

    // Bulk invoice the student; the confirm dialog previews the count and the total.
    const bulk = await hydrated(page, 'bulk-invoice-form');
    await bulk.locator('#bi-structure').selectOption(structure.id);
    await bulk.locator('#bi-students-pick').selectOption(student.id);
    await expect(bulk).toContainText(student.label);
    await bulk.locator('#bi-due').fill(utcDate(14));
    await bulk.getByTestId('submit-bulk-invoice').click();
    await expect(page.getByTestId('bulk-invoice-confirm')).toContainText(
      '1 invoice(s) totalling ₹1,000.00 will be created.',
    );
    await page.getByTestId('bulk-invoice-confirm-confirm').click();
    await expect(page.getByTestId('bulk-invoice-result')).toHaveAttribute('data-created', '1');
    await expect(page.getByTestId('bulk-invoice-result')).toHaveText('1 invoice(s) created.');

    const [invoice] = await invoicesFor(request, admin, student.id);
    expect(invoice).toMatchObject({
      structureId: structure.id,
      amountCents: 100_000,
      status: 'open',
      dueAt: `${utcDate(14)}T00:00:00.000Z`,
    });
    const invoiceRow = await openInvoiceRow(page, request, admin, invoice!);
    await expect(invoiceRow).toContainText(
      `₹1,000.00 · ${student.label} · Open · ${invoice!.invoiceNumber}`,
    );

    // Running it again bills nobody twice.
    await page.goto('/fees/structures', { waitUntil: 'domcontentloaded' });
    const again = await hydrated(page, 'bulk-invoice-form');
    await again.locator('#bi-structure').selectOption(structure.id);
    await again.locator('#bi-students-pick').selectOption(student.id);
    await again.getByTestId('submit-bulk-invoice').click();
    await expect(again.getByRole('alert')).toHaveText(
      'Every selected student already has an invoice for this structure.',
    );
    expect(await invoicesFor(request, admin, student.id)).toHaveLength(1);
  });

  test('/fees/reconciliation: import a rupee CSV and resolve its exception through the forms', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = feesAdmin(`fe-w-admin-${tag}`);
    const student = await createStudent(request, admin, tag);
    const { invoice } = await structureInvoice(request, admin, {
      name: `FE recon tuition ${tag}`,
      code: `FE-RC${tag}`,
      amountCents: 99_999,
      studentId: student.id,
    });
    const filename = `fe-w-${tag}.csv`;
    const missing = `FE-NOPE-${tag}`;
    await openAs(page, admin);
    await page.goto('/fees/reconciliation', { waitUntil: 'domcontentloaded' });
    const form = await hydrated(page, 'recon-import-form');
    await (await ready(form.locator('#recon-filename'))).fill(filename);
    await form.getByLabel('Rupees (e.g. 5000.50)').check();
    await form
      .locator('#recon-csv')
      .fill(`invoiceNumber,amount\n${invoice.invoiceNumber},999.99\n${missing},12.34`);
    await form.getByTestId('submit-recon').click();
    await expect(page.getByTestId('recon-summary')).toHaveText(
      `Imported ${filename} — matched 1, exceptions 1.`,
    );
    await expect(page).toHaveURL(/\/fees\/reconciliation\?batch=[0-9a-f-]{36}$/);
    const batchId = new URL(page.url()).searchParams.get('batch')!;

    const batch = page.locator(`[data-testid="recon-batch-row"][data-batch-id="${batchId}"]`);
    await expect(batch).toContainText(`${filename} · matched 1 · exceptions 1`);
    await expect(page.getByTestId('recon-match-row')).toContainText(
      `${invoice.invoiceNumber}₹999.99 · matched`,
    );
    const exception = page.getByTestId('recon-exception-row');
    await expect(exception).toContainText(`${missing}₹12.34 · invoice not found · open`);

    // Resolve the exception with an audit note.
    const note = `FE bank fee ${tag}`;
    await exception.locator('select[name="status"]').selectOption('ignored');
    await exception.locator('textarea[name="resolutionNote"]').fill(note);
    await exception.getByTestId('submit-recon-resolve').click();
    await expect(exception).toHaveAttribute('data-exception-status', 'ignored');
    await expect(exception.getByTestId('recon-exception-audit')).toContainText(`— ${note}`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('recon-exception-row')).toContainText(
      '₹12.34 · invoice not found · ignored',
    );
    await expect(page.getByTestId('recon-exception-audit')).toContainText(
      `by ${admin.sub} — ${note}`,
    );

    const rows = await send<{ data: Array<Record<string, unknown>> }>(
      request,
      admin,
      'GET',
      `/fees/reconciliation/batches/${batchId}/rows`,
    );
    expect(rows.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          invoiceNumber: invoice.invoiceNumber,
          amountCents: 99_999,
          matched: true,
          invoiceId: invoice.id,
        }),
        expect.objectContaining({
          invoiceNumber: missing,
          amountCents: 1_234,
          matched: false,
          exceptionStatus: 'ignored',
          resolutionNote: note,
          resolvedBy: admin.sub,
        }),
      ]),
    );
    expect(rows.data).toHaveLength(2);
  });

  test('/fees/scholarship-netting: the netting form credits a paid disbursement to an invoice', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const admin = feesAdmin(`fe-w-admin-${tag}`);
    const student = await createStudent(request, admin, tag);
    const { invoice } = await structureInvoice(request, admin, {
      name: `FE netting tuition ${tag}`,
      code: `FE-NT${tag}`,
      amountCents: 100_000,
      studentId: student.id,
    });
    const disbursement = await scheduledDisbursement(request, admin, student.id, 250.5, tag);
    expect(disbursement.amountCents).toBe(25_050);
    // Test seam (fixtures/fees-screens.ts): paid without the fee-outbox delivery, so the
    // credit is applied through this screen instead of the automatic hook.
    markDisbursementPaidUndelivered(disbursement.id, admin.tenantId, utcDate(0), `FE-TX-${tag}`);

    await openAs(page, admin);
    await page.goto('/fees/scholarship-netting', { waitUntil: 'domcontentloaded' });
    const form = await hydrated(page, 'scholarship-netting-form');
    await pick(form, 'net-disbursement', student.label, disbursement.id);
    await pick(form, 'net-invoice', invoice.invoiceNumber, invoice.id);
    await form.getByTestId('submit-scholarship-netting').click();
    await page.getByTestId('scholarship-netting-confirm-confirm').click();

    const result = page.getByTestId('netting-result');
    await expect(result).toContainText('Credit applied to invoice.');
    await expect(result).toContainText('Discount: ₹250.50');
    await expect(result).toContainText(`Invoice: ${invoice.invoiceNumber}balance ₹749.50 (Open)`);

    // The disbursement is no longer offered, and the invoice shows the new balance.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await hydrated(page, 'scholarship-netting-form');
    await expect(page.locator(`#net-disbursement option[value="${disbursement.id}"]`)).toHaveCount(
      0,
    );
    const row = await openInvoiceRow(page, request, admin, invoice);
    await expect(row).toContainText(`₹749.50 · ${student.label} · Open`);

    expect((await invoicesFor(request, admin, student.id))[0]).toMatchObject({
      amountCents: 74_950,
      status: 'open',
    });
    // Applying it again is idempotent and reports the stored credit.
    const replay = await send<{ idempotent: boolean; discountCents: number }>(
      request,
      admin,
      'POST',
      '/fees/scholarships/net',
      { studentId: student.id, disbursementId: disbursement.id },
      200,
    );
    expect(replay).toMatchObject({ idempotent: true, discountCents: 25_050 });
    expect((await invoicesFor(request, admin, student.id))[0]!.amountCents).toBe(74_950);
  });

  test('/fees/dunning: send a reminder, then add and remove a suppression through the forms', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const admin = feesAdmin(`fe-w-admin-${tag}`);
    const student = await createStudent(request, admin, tag);
    const invoice = await send<FeeInvoice>(request, admin, 'POST', '/fees/invoices', {
      studentId: student.id,
      title: `FE overdue ${tag}`,
      amountCents: 150_075,
      dueAt: utcDate(-10),
    });
    try {
      await openAs(page, admin);
      await page.goto('/fees/dunning', { waitUntil: 'domcontentloaded' });
      await hydrated(page, 'dunning-console');
      const table = page.getByTestId('dunning-overdue-table');
      let row = table.locator('tr', { hasText: invoice.invoiceNumber });
      await expect(row).toContainText(`${student.label}₹1,500.75`);
      await expect(row).toContainText('Sendable');

      // Send one sandbox email reminder for this invoice.
      await row.getByRole('checkbox', { name: `Select invoice ${invoice.invoiceNumber}` }).check();
      await page.getByTestId('dunning-send').click();
      await expect(page.getByTestId('dunning-send-confirm')).toContainText(
        'Sandbox reminders will be queued for 1 selected invoice.',
      );
      await page.getByTestId('dunning-send-confirm-confirm').click();
      const sent = page.getByTestId('dunning-send-result');
      const invoiceLabel = `Invoice ${invoice.id.slice(0, 8)}`;
      await expect(sent.locator('li')).toHaveCount(1);
      await expect(sent.locator('li')).toContainText(`${invoiceLabel} · email · `);
      const audits = await send<{
        data: Array<{ invoiceId: string; channel: string; messageId: string; mode: string }>;
      }>(request, admin, 'GET', '/fees/reminders/audit');
      const mine = audits.data.filter((a) => a.invoiceId === invoice.id);
      expect(mine).toEqual([expect.objectContaining({ channel: 'email', mode: 'sandbox' })]);
      await expect(sent.locator('li')).toHaveText(
        `${invoiceLabel} · email · ${mine[0]!.messageId}`,
      );
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(
        page.getByTestId('dunning-audit-list').locator('li', { hasText: mine[0]!.messageId }),
      ).toContainText(invoiceLabel);

      // Suppress reminders for the student.
      const reason = `FE payment plan agreed ${tag}`;
      const suppress = page.getByTestId('dunning-suppression-form');
      await ready(suppress.locator('#sup-reason'));
      await pick(suppress, 'sup-student', student.label, student.id);
      await suppress.locator('#sup-reason').fill(reason);
      await page.getByRole('button', { name: 'Add suppression' }).click();
      const listed = page
        .getByTestId('dunning-suppression-list')
        .locator('li', { hasText: reason });
      await expect(listed).toHaveCount(1);
      await expect(listed).toContainText(student.label);
      row = table.locator('tr', { hasText: invoice.invoiceNumber });
      await expect(row).toContainText('Suppressed');
      await expect(row.getByRole('checkbox')).toBeDisabled();
      const suppressions = await send<{
        data: Array<{ id: string; reason: string; studentId: string }>;
      }>(request, admin, 'GET', '/fees/reminders/suppressions');
      expect(suppressions.data.filter((s) => s.reason === reason)).toEqual([
        expect.objectContaining({ studentId: student.id }),
      ]);

      // Remove it again.
      await listed.getByRole('button', { name: 'Remove' }).click();
      await page.getByTestId('dunning-remove-suppression-confirm-confirm').click();
      await expect(listed).toHaveCount(0);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(
        page.getByTestId('dunning-overdue-table').locator('tr', { hasText: invoice.invoiceNumber }),
      ).toContainText('Sendable');
      const after = await send<{ data: Array<{ reason: string }> }>(
        request,
        admin,
        'GET',
        '/fees/reminders/suppressions',
      );
      expect(after.data.filter((s) => s.reason === reason)).toEqual([]);
    } finally {
      await settle(request, admin, [invoice.id]);
    }
  });
});
