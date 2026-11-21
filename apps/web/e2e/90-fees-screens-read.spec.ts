import { expect, test, type Page } from '@playwright/test';
import {
  BACKEND_READY,
  cleanupFeesData,
  feesAdmin,
  inr,
  newTag,
  openAs,
  pageOf,
  send,
  seedFeesData,
  type SeededFeesData,
} from './fixtures/fees-screens';

/**
 * Fees module — every screen shows rows written through the live API (screen → API → DB).
 *
 * `beforeAll` seeds one data set with a unique tag through the gateway: a plan and a plan
 * invoice with a partial cash payment, a class-linked structure invoice with a ₹0.99 UPI
 * payment, a reconciliation batch, a reminder suppression and a paid (un-netted)
 * scholarship disbursement. Each test opens one of the nine fees screens as a tenant
 * administrator and finds this run's rows by their unique strings; the paged invoice and
 * receipt lists are opened at the page that holds the seeded row.
 *
 * Money is asserted as exact paise from the seed in the screens' `₹1,234.56` format, with
 * paisa remainders: ₹1,234.56 − ₹1,000.05 = ₹234.51 and ₹999.99 − ₹0.99 = ₹999.00.
 *
 * Known open defects are not asserted here (defects.md): the hub's invoice and receipt
 * counts stop at 50 (F-D4); scholarship netting credits ₹0 against an ad-hoc or plan
 * invoice and drops the part of a scholarship above the open amount (F-D1, F-D2).
 */

function listItem(page: Page, testId: string, text: string) {
  return page.getByTestId(testId).filter({ hasText: text });
}

/** Invoice status words as the dues report renders them (`humanizeStatus`). */
const STATUS_WORD: Record<string, string> = {
  open: 'Open',
  overdue: 'Overdue',
  paid: 'Paid',
  void: 'Void',
  written_off: 'Written Off',
};

/** Whole days overdue for a due date, as the server computes them at request time. */
function overdueDays(dueAt: string | null): string {
  return `${Math.floor((Date.now() - Date.parse(dueAt ?? '')) / 86_400_000)}d`;
}

test.describe('Fees screens — read path (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires live gateway (E2E_BACKEND_READY)');

  let d: SeededFeesData;
  const tag = newTag();
  const admin = feesAdmin(`fe-admin-${tag}`);

  test.beforeAll(async ({ request }) => {
    d = await seedFeesData(request, admin, tag);
  });

  test.afterAll(async ({ request }) => {
    if (d) await cleanupFeesData(request, admin, d);
  });

  test.beforeEach(async ({ page }) => {
    await openAs(page, admin);
  });

  test('/fees shows the plan count from the API and opens the plan register', async ({
    page,
    request,
  }) => {
    const plans = await send<{ data: Array<{ id: string }> }>(request, admin, 'GET', '/fees/plans');
    expect(plans.data.map((p) => p.id)).toContain(d.plan.id);
    await page.goto('/fees', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Fees' })).toBeVisible();
    const n = plans.data.length;
    await expect(
      page.getByText(n === 1 ? '1 plan.' : `${n} plans.`, { exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Manage plans' }).filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/fees\/plans$/);
    await expect(listItem(page, 'fee-plan-row', d.plan.name)).toHaveCount(1);
  });

  test('/fees/plans lists the seeded plan with code, amount, frequency and status', async ({
    page,
    request,
  }) => {
    const plans = await send<{ data: unknown[] }>(request, admin, 'GET', '/fees/plans');
    await page.goto('/fees/plans', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Fee plans' })).toBeVisible();
    await expect(page.getByText(`${plans.data.length} plan(s).`, { exact: true })).toBeVisible();
    const row = listItem(page, 'fee-plan-row', d.plan.name);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`${d.plan.name} (${d.plan.code})`);
    await expect(row).toContainText('₹1,234.56 · Term · Active');
  });

  test('/fees/invoices lists both seeded invoices with amount, student, status and number', async ({
    page,
    request,
  }) => {
    const plan = await pageOf(request, admin, '/fees/invoices', d.planInvoice.id);
    await page.goto(`/fees/invoices?page=${plan.page}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Fee invoices' })).toBeVisible();
    await expect(
      page.getByText(`${plan.totalItems.toLocaleString('en-US')} invoice(s).`, { exact: true }),
    ).toBeVisible();
    const planRow = listItem(page, 'fee-invoice-row', d.planInvoice.invoiceNumber);
    await expect(planRow).toHaveCount(1);
    await expect(planRow).toContainText(
      `₹1,234.56 · ${d.student.label} · Open · ${d.planInvoice.invoiceNumber} · ${d.plan.name}`,
    );
    await expect(planRow.getByTestId('staff-pay-invoice')).toHaveCount(1);
    await expect(planRow.getByTestId('open-refund')).toHaveCount(0);

    const structure = await pageOf(request, admin, '/fees/invoices', d.structureInvoice.id);
    if (structure.page !== plan.page) {
      await page.goto(`/fees/invoices?page=${structure.page}`, { waitUntil: 'domcontentloaded' });
    }
    const structureRow = listItem(page, 'fee-invoice-row', d.structureInvoice.invoiceNumber);
    await expect(structureRow).toHaveCount(1);
    await expect(structureRow).toContainText(d.structure.name);
    await expect(structureRow).toContainText(
      `₹999.99 · ${d.student.label} · Open · ${d.structureInvoice.invoiceNumber}`,
    );
    // Structure invoices offer a concession; plan invoices do not.
    await expect(structureRow.getByTestId('open-concession')).toHaveCount(1);
    await expect(planRow.getByTestId('open-concession')).toHaveCount(0);

    // The status filter is applied server-side: an open invoice is not under "Paid".
    await page.goto('/fees/invoices?status=paid', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('link', { name: 'Paid', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(listItem(page, 'fee-invoice-row', d.planInvoice.invoiceNumber)).toHaveCount(0);
  });

  test('/fees/receipts lists both seeded receipts with amount and invoice number', async ({
    page,
    request,
  }) => {
    const first = await pageOf(request, admin, '/fees/receipts', d.planReceipt.id);
    await page.goto(`/fees/receipts?page=${first.page}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Fee receipts' })).toBeVisible();
    await expect(
      page.getByText(`${first.totalItems.toLocaleString('en-US')} receipt(s).`, { exact: true }),
    ).toBeVisible();
    const planReceipt = listItem(page, 'fee-receipt-row', d.planReceipt.receiptNumber);
    await expect(planReceipt).toHaveCount(1);
    await expect(planReceipt).toContainText(`₹1,000.05 · ${d.planInvoice.invoiceNumber} · `);

    const second = await pageOf(request, admin, '/fees/receipts', d.structureReceipt.id);
    if (second.page !== first.page) {
      await page.goto(`/fees/receipts?page=${second.page}`, { waitUntil: 'domcontentloaded' });
    }
    const structureReceipt = listItem(page, 'fee-receipt-row', d.structureReceipt.receiptNumber);
    await expect(structureReceipt).toHaveCount(1);
    await expect(structureReceipt).toContainText(`₹0.99 · ${d.structureInvoice.invoiceNumber} · `);
  });

  test('/fees/structures lists the seeded structure with amount, category and term', async ({
    page,
  }) => {
    await page.goto('/fees/structures', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Fee structures' })).toBeVisible();
    const row = page.locator(
      `[data-testid="fee-structure-row"][data-structure-code="${d.structure.code}"]`,
    );
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`${d.structure.name} (${d.structure.code})`);
    await expect(row).toContainText(`₹999.99 · tuition · ${d.structure.term}`);
    // The bulk-invoice form offers the seeded structure.
    await expect(page.locator(`#bi-structure option[value="${d.structure.id}"]`)).toHaveText(
      `${d.structure.code} — ${d.structure.name}`,
    );
  });

  test('/fees/reports shows the seeded class dues and the API status totals', async ({
    page,
    request,
  }) => {
    const report = await send<{
      byStatus: Array<{ status: string; count: number; amountCents: number }>;
      byClass: Array<{ classId: string; openCents: number; overdueCents: number }>;
    }>(request, admin, 'GET', '/fees/reports/dues');
    expect(report.byClass.filter((r) => r.classId === d.klass!.id)).toEqual([
      expect.objectContaining({
        openCount: 1,
        overdueCount: 1,
        openCents: 99_900,
        overdueCents: 99_900,
      }),
    ]);
    await page.goto('/fees/reports', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Fee reports' })).toBeVisible();
    // Outstanding = face − paid: ₹999.99 − ₹0.99.
    const classRow = listItem(page, 'dues-class-row', d.klass!.name);
    await expect(classRow).toHaveCount(1);
    await expect(classRow).toContainText('Open 1 (₹999.00) · Overdue 1 (₹999.00)');
    for (const row of report.byStatus) {
      await expect(
        page
          .getByTestId('dues-status-row')
          .filter({ hasText: `${STATUS_WORD[row.status] ?? row.status}: ${row.count} · ` }),
      ).toHaveText(
        `${STATUS_WORD[row.status] ?? row.status}: ${row.count} · ${inr(row.amountCents)}`,
      );
    }
    await expect(page.getByTestId('dues-status-row')).toHaveCount(report.byStatus.length);
  });

  test('/fees/reconciliation shows the seeded batch, its match and its open exception', async ({
    page,
  }) => {
    await page.goto(`/fees/reconciliation?batch=${d.batch.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Reconciliation' })).toBeVisible();
    const batch = page.locator(`[data-testid="recon-batch-row"][data-batch-id="${d.batch.id}"]`);
    await expect(batch).toContainText(`${d.batch.filename} · matched 1 · exceptions 1`);
    await expect(batch).toHaveAttribute('aria-pressed', 'true');
    const match = page.getByTestId('recon-match-row');
    await expect(match).toHaveCount(1);
    await expect(match).toContainText(d.structureInvoice.invoiceNumber);
    await expect(match).toContainText('₹999.99 · matched');
    const exception = page.getByTestId('recon-exception-row');
    await expect(exception).toHaveCount(1);
    await expect(exception).toContainText(d.batch.missing);
    await expect(exception).toContainText('₹12.34 · invoice not found · open');
    await expect(exception).toHaveAttribute('data-exception-status', 'open');
    await expect(exception.getByTestId('recon-resolve-form')).toHaveCount(1);
  });

  test('/fees/scholarship-netting offers the paid disbursement and the student invoice', async ({
    page,
  }) => {
    await page.goto('/fees/scholarship-netting', { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Scholarship netting' }),
    ).toBeVisible();
    await page.locator('#net-disbursement-search').fill(d.student.label);
    await expect(
      page.locator(`#net-disbursement option[value="${d.disbursement!.id}"]`),
    ).toHaveText(`${d.student.label} · ₹250.50 · paid ${d.disbursement!.paidDate}`);
    await page.locator('#net-invoice-search').fill(d.structureInvoice.invoiceNumber);
    await expect(page.locator(`#net-invoice option[value="${d.structureInvoice.id}"]`)).toHaveText(
      d.structureInvoice.invoiceNumber,
    );
  });

  test('/fees/dunning shows both overdue invoices, the suppression and the outstanding amounts', async ({
    page,
  }) => {
    await page.goto('/fees/dunning', { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Dunning / reminders' }),
    ).toBeVisible();
    const table = page.getByTestId('dunning-overdue-table');
    const planRow = table.locator('tr', { hasText: d.planInvoice.invoiceNumber });
    await expect(planRow).toHaveCount(1);
    await expect(planRow.locator('td')).toHaveText([
      '',
      d.planInvoice.invoiceNumber,
      d.student.label,
      '₹234.51',
      overdueDays(d.planInvoice.dueAt),
      'Suppressed',
    ]);
    await expect(planRow.getByRole('checkbox')).toBeDisabled();
    const structureRow = table.locator('tr', { hasText: d.structureInvoice.invoiceNumber });
    await expect(structureRow.locator('td')).toHaveText([
      '',
      d.structureInvoice.invoiceNumber,
      d.student.label,
      '₹999.00',
      overdueDays(d.structureInvoice.dueAt),
      'Sendable',
    ]);
    const suppression = page
      .getByTestId('dunning-suppression-list')
      .locator('li', { hasText: d.suppression.reason });
    await expect(suppression).toHaveCount(1);
    await expect(suppression).toContainText(`Invoice ${d.planInvoice.id.slice(0, 8)}`);
  });
});
