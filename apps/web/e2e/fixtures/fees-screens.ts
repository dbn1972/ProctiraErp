/**
 * Fees screen coverage — shared personas, per-run seeding and helpers (specs 90–92).
 *
 * Every test seeds its own students, plans, structures, invoices, payments, reconciliation
 * batches, suppressions and scholarship disbursements through the live gateway with a
 * unique tag, so assertions find this run's rows regardless of leftovers on a reused
 * database. The paged fee lists (`/fees/invoices`, `/fees/receipts`) are opened at the page
 * that holds the seeded row (found by walking the API pages), so earlier runs never push a
 * seeded row out of view. Plans, structures, reconciliation batches, suppressions and the
 * overdue feed are uncapped lists.
 *
 * Re-run safety: the fee API has no delete routes for invoices, so tests settle the
 * overdue invoices they create (pay the outstanding balance) and remove the suppressions
 * and nettable disbursements they create, so the overdue feed and the netting picker do
 * not grow run over run.
 *
 * Screen persona: a tenant administrator (`roleId: 'admin'`). Gateway RBAC refuses the
 * finance roles (finance_officer, bursar, accountant, registrar) today (F-D3, defects.md),
 * so they are not used here.
 *
 * Money: amounts are integer paise in the API and `₹1,234.56` (locale `en`) on screen.
 * Specs assert literal strings for seeded rows. Tenant-wide aggregates (dues by status)
 * are compared with `inr()` over the API's own numbers.
 *
 * Strings never look like real people: they start with `FE ` / `Fe` and carry the tag.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { createSignedJwt, setupGatewayTenantSession } from './fake-session';
import { ensureSharedAcademicYear, uniqueGradeOrder } from './test-data';

export const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
export const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
/** Seeded by tools/e2e/seed-e2e-tenants.sql. */
export const TENANT_A = '00000000-0000-4000-8000-000000000001';
export const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
export const INSTITUTION_A = 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 8 upper-case hex characters, unique per call. */
export function newTag(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}

/** UTC calendar date `days` from now (derived from the run, never hard-coded). */
export function utcDate(days = 0): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** INR in the screens' format (locale `en`), for tenant-wide aggregates only. */
export function inr(cents: number): string {
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export interface PersonaRole {
  roleId: string;
  roleName: string;
  areaId: string | null;
}
export interface Persona {
  sub: string;
  email: string;
  displayName: string;
  tenantId: string;
  roles: PersonaRole[];
}
function persona(sub: string, tenantId: string, role: PersonaRole, displayName: string): Persona {
  return { sub, email: `${sub}@tenant.test`, displayName, tenantId, roles: [role] };
}
/** Tenant administrator: the staff persona with fees access (web guard, gateway, package). */
export function feesAdmin(sub: string, tenantId: string = TENANT_A): Persona {
  return persona(
    sub,
    tenantId,
    { roleId: 'admin', roleName: 'Administrator', areaId: null },
    'FE Administrator',
  );
}
/** Staff without fees access (gateway grants fees read; the fees package refuses). */
export function teacher(sub: string, tenantId: string = TENANT_A): Persona {
  return persona(
    sub,
    tenantId,
    { roleId: 'teacher', roleName: 'Teacher', areaId: null },
    'FE Teacher',
  );
}
export function studentUser(sub: string, tenantId: string = TENANT_A): Persona {
  return persona(
    sub,
    tenantId,
    { roleId: 'student', roleName: 'Student', areaId: null },
    'FE Student',
  );
}
export function parentUser(sub: string, tenantId: string = TENANT_A): Persona {
  return persona(
    sub,
    tenantId,
    { roleId: 'parent', roleName: 'Parent', areaId: null },
    'FE Parent',
  );
}

/** Gateway headers for `persona` (HS256 JWT accepted by the live gateway). */
export function apiHeaders(p: Persona, extra: Record<string, string> = {}): Record<string, string> {
  const token = createSignedJwt({ ...p, institutions: [] });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-ID': p.tenantId,
    ...extra,
  };
}

/** Browser session cookies for `persona`. */
export async function openAs(page: Page, p: Persona): Promise<void> {
  await setupGatewayTenantSession(page, p);
}

export type Row = Record<string, unknown>;

/** One gateway call that must answer `status`; returns the JSON body. */
export async function send<T = Row>(
  request: APIRequestContext,
  p: Persona,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  data?: Row,
  status = method === 'POST' ? 201 : 200,
): Promise<T> {
  const res = await request.fetch(`${GATEWAY_URL}/api/v1${path}`, {
    method,
    headers: apiHeaders(p),
    data,
  });
  const text = await res.text();
  expect(res.status(), `${method} ${path}: ${text.slice(0, 300)}`).toBe(status);
  return (text ? JSON.parse(text) : null) as T;
}

export interface FeeInvoice {
  id: string;
  studentId: string;
  planId: string | null;
  structureId: string | null;
  classId: string | null;
  title: string;
  amountCents: number;
  currency: string;
  status: string;
  invoiceNumber: string;
  dueAt: string | null;
}
export interface FeeReceipt {
  id: string;
  invoiceId: string;
  receiptNumber: string;
  amountCents: number;
  currency: string;
}

/** The student's invoices (server-side `studentId` filter, uncapped). */
export async function invoicesFor(
  request: APIRequestContext,
  p: Persona,
  studentId: string,
): Promise<FeeInvoice[]> {
  return (
    await send<{ data: FeeInvoice[] }>(request, p, 'GET', `/fees/invoices?studentId=${studentId}`)
  ).data;
}

/**
 * The 1-based page (50 rows, the screens' page size) of `path` that holds `id`, walking the
 * same server-side paging the screen uses, so a seeded row is found however many rows
 * earlier runs left behind. Also returns the list total.
 */
export async function pageOf(
  request: APIRequestContext,
  p: Persona,
  path: '/fees/invoices' | '/fees/receipts',
  id: string,
): Promise<{ page: number; totalItems: number }> {
  for (let page = 1; page <= 400; page += 1) {
    const body = await send<{
      data: Array<{ id: string }>;
      meta: { totalItems: number; totalPages: number };
    }>(request, p, 'GET', `${path}?page=${page}&pageSize=50`);
    if (body.data.some((row) => row.id === id)) {
      return { page, totalItems: body.meta.totalItems };
    }
    if (page >= body.meta.totalPages) break;
  }
  throw new Error(`${path}: row ${id} not found on any page`);
}

export interface SeededStudent {
  id: string;
  /** Directory label the fee screens render (`CODE · First Last`). */
  label: string;
}

export async function createStudent(
  request: APIRequestContext,
  p: Persona,
  tag: string,
  prefix = 'Fe',
): Promise<SeededStudent> {
  const firstName = `${prefix}${tag}`;
  const lastName = 'Payer';
  const created = await send<Row & { id: string }>(request, p, 'POST', '/students', {
    firstName,
    lastName,
    dateOfBirth: '2012-04-04',
    gender: 'female',
  });
  // The tenant assigns an admission number; the directory label is `CODE · First Last`
  // (`toStudentOption` in apps/web/src/lib/load-entity-labels.ts).
  const data = (created.customData ?? {}) as Record<string, unknown>;
  const code = ['admissionNumber', 'admissionNo', 'rollNumber', 'studentCode']
    .map((key) => data[key])
    .find((value) => (typeof value === 'string' && value.trim()) || typeof value === 'number');
  const name = `${firstName} ${lastName}`;
  return { id: created.id, label: code === undefined ? name : `${String(code).trim()} · ${name}` };
}

/** A class of the shared academic year in institution A, named after `tag`. */
export async function createClass(
  request: APIRequestContext,
  p: Persona,
  tag: string,
): Promise<{ id: string; name: string }> {
  const period = await ensureSharedAcademicYear(request, GATEWAY_URL, apiHeaders(p));
  const grade = await send<{ id: string }>(request, p, 'POST', '/grades', {
    name: `FE grade ${tag}`,
    code: `FEG${tag.slice(0, 5)}`,
    order: uniqueGradeOrder(),
  });
  const name = `FE class ${tag}`;
  const klass = await send<{ id: string }>(request, p, 'POST', '/classes', {
    institutionId: INSTITUTION_A,
    gradeId: grade.id,
    academicPeriodId: period.id,
    name,
    capacity: 30,
  });
  return { id: klass.id, name };
}

/** One fee structure (INR, institution A) invoiced to `studentIds` in one bulk run. */
export async function structureInvoice(
  request: APIRequestContext,
  p: Persona,
  input: {
    name: string;
    code: string;
    amountCents: number;
    term?: string;
    studentId: string;
    classId?: string;
    dueAt?: string;
    institutionId?: string | null;
  },
): Promise<{ structure: { id: string; code: string }; invoice: FeeInvoice }> {
  const structure = await send<{ id: string; code: string }>(
    request,
    p,
    'POST',
    '/fees/structures',
    {
      name: input.name,
      code: input.code,
      category: 'tuition',
      ...(input.term ? { term: input.term } : {}),
      amountCents: input.amountCents,
      currency: 'INR',
      ...(input.institutionId === null
        ? {}
        : { institutionId: input.institutionId ?? INSTITUTION_A }),
    },
  );
  const bulk = await send<{ created: FeeInvoice[] }>(
    request,
    p,
    'POST',
    `/fees/structures/${structure.id}/bulk-invoice`,
    {
      studentIds: [input.studentId],
      ...(input.classId ? { classId: input.classId } : {}),
      ...(input.dueAt ? { dueAt: input.dueAt } : {}),
    },
  );
  expect(bulk.created).toHaveLength(1);
  return { structure, invoice: bulk.created[0]! };
}

/** A staff-recorded payment (cash / UPI) with its receipt. */
export async function pay(
  request: APIRequestContext,
  p: Persona,
  invoiceId: string,
  amountCents: number,
  reference: string,
  method: 'cash' | 'upi' = 'cash',
): Promise<{ invoice: FeeInvoice; receipt: FeeReceipt }> {
  return send(request, p, 'POST', `/fees/invoices/${invoiceId}/pay`, {
    method,
    amountCents,
    reference,
    idempotencyKey: randomUUID(),
  });
}

/**
 * Re-run hygiene: pay what is still outstanding on invoices this test created, so overdue
 * rows do not pile up in the overdue feed and the dues report on a reused database.
 */
export async function settle(
  request: APIRequestContext,
  p: Persona,
  invoiceIds: string[],
): Promise<void> {
  const overdue = await send<{ data: Array<{ invoiceId: string; amountCents: number }> }>(
    request,
    p,
    'GET',
    '/fees/reminders/overdue',
  );
  for (const row of overdue.data.filter((r) => invoiceIds.includes(r.invoiceId))) {
    await pay(request, p, row.invoiceId, row.amountCents, `FE-SETTLE-${row.invoiceId.slice(0, 8)}`);
  }
}

/** Approved scholarship award for `studentId`; approval schedules one disbursement. */
export async function scheduledDisbursement(
  request: APIRequestContext,
  p: Persona,
  studentId: string,
  amount: number,
  tag: string,
): Promise<{ id: string; amountCents: number }> {
  const program = await send<{ id: string }>(request, p, 'POST', '/scholarships/programs', {
    name: `FE programme ${tag}`,
    applicationStartDate: '2020-01-01',
    applicationEndDate: '2099-12-31',
    totalSlots: 5,
    amountPerRecipient: amount,
    currency: 'INR',
    eligibility: { requiredDocuments: [] },
  });
  await send(request, p, 'PUT', `/scholarships/programs/${program.id}`, { status: 'open' });
  const application = await send<{ id: string }>(request, p, 'POST', '/scholarships/applications', {
    programId: program.id,
    applicantId: studentId,
    institutionId: INSTITUTION_A,
    academicRecords: [{ institutionName: 'FE school', educationLevel: 'secondary', gpa: 3.4 }],
    financialInfo: { familyIncome: 150000 },
    documents: [],
  });
  await send(request, p, 'POST', `/scholarships/applications/${application.id}/approve`, {}, 200);
  const list = await send<{
    data: Array<{ id: string; amountCents: number; paymentStatus: string }>;
  }>(request, p, 'GET', `/scholarships/applications/${application.id}/disbursements`);
  expect(list.data).toHaveLength(1);
  expect(list.data[0]!.paymentStatus).toBe('scheduled');
  return { id: list.data[0]!.id, amountCents: list.data[0]!.amountCents };
}

/**
 * A scheduled date that moves one day earlier for every day of wall time, so the newest
 * run's disbursement sorts first in the netting picker's source list (paid disbursements,
 * oldest scheduled date first, first 200 rows; `scholarship-disbursement-lookup.ts`).
 */
function rerunSafeScheduledDate(): string {
  const anchor = Date.UTC(2026, 0, 1);
  return new Date(anchor - (Date.now() - anchor)).toISOString().slice(0, 10);
}

function databaseUrl(): string {
  // Same role order as helpers/library-loans.ts.
  const url = process.env.MIGRATOR_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATOR_DATABASE_URL or DATABASE_URL is required for SQL setup');
  return url;
}

const MARK_PAID_UNDELIVERED_SQL = `
SELECT set_config('app.tenant_id', :'tenant', false);
UPDATE scholarship_disbursements
   SET payment_status = 'paid', paid_date = :'paid'::date, transaction_reference = :'ref',
       scheduled_date = :'scheduled'::date, updated_at = now()
 WHERE id = :'id'::uuid AND tenant_id = :'tenant'::uuid AND payment_status = 'scheduled'
RETURNING 'updated:' || id;
`;

/**
 * TEST SEAM (fees specs 90–92 only; never use it elsewhere). Simulates an undelivered
 * fee-outbox event: the disbursement this run seeded is marked paid directly in the
 * database, so the `disbursement.paid` fee hook (which nets the credit at once when the
 * status changes through the API) never runs and the disbursement stays in
 * `/fees/scholarships/nettable-disbursements` for the netting screen to apply. There is no
 * API or config path that leaves a paid disbursement un-netted: `PUT
 * /scholarships/disbursements/:id` delivers the outbox row immediately. Touches exactly one
 * row, keyed by id and tenant, and only while it is still `scheduled`. Values are psql
 * variables (`:'name'`), never spliced into SQL.
 */
export function markDisbursementPaidUndelivered(
  disbursementId: string,
  tenantId: string,
  paidDate: string,
  reference: string,
): void {
  if (!UUID_RE.test(disbursementId))
    throw new Error(`Unexpected disbursement id: ${disbursementId}`);
  if (!UUID_RE.test(tenantId)) throw new Error(`Unexpected tenant id: ${tenantId}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) throw new Error(`Unexpected paid date: ${paidDate}`);
  if (!/^[A-Za-z0-9-]{1,64}$/.test(reference))
    throw new Error(`Unexpected reference: ${reference}`);
  const vars = {
    tenant: tenantId,
    id: disbursementId,
    paid: paidDate,
    ref: reference,
    scheduled: rerunSafeScheduledDate(),
  };
  const args = [databaseUrl(), '-v', 'ON_ERROR_STOP=1', '-qAt'];
  for (const [name, value] of Object.entries(vars)) args.push('-v', `${name}=${value}`);
  const out = execFileSync('psql', args, {
    input: MARK_PAID_UNDELIVERED_SQL,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (!out.includes(`updated:${disbursementId}`)) {
    throw new Error(`Disbursement ${disbursementId} was not marked paid: ${out}`);
  }
}

/** Re-run hygiene: cancel a nettable disbursement the test left un-netted. */
export async function cancelDisbursement(
  request: APIRequestContext,
  p: Persona,
  disbursementId: string,
): Promise<void> {
  await send(request, p, 'PUT', `/scholarships/disbursements/${disbursementId}`, {
    paymentStatus: 'cancelled',
  });
}

export interface SeededFeesData {
  tag: string;
  student: SeededStudent;
  /** Tenant A only (tenant B has no institution to hang a class or a scholarship on). */
  klass: { id: string; name: string } | null;
  plan: { id: string; name: string; code: string };
  /** Plan invoice ₹1,234.56, due 10 days ago, ₹1,000.05 paid → ₹234.51 outstanding. */
  planInvoice: FeeInvoice;
  planReceipt: FeeReceipt;
  structure: { id: string; name: string; code: string; term: string };
  /** Structure invoice ₹999.99 for the class, due 10 days ago, ₹0.99 paid → ₹999.00 outstanding. */
  structureInvoice: FeeInvoice;
  structureReceipt: FeeReceipt;
  batch: { id: string; filename: string; missing: string };
  suppression: { id: string; reason: string };
  /** Paid but un-netted ₹250.50 (test seam); tenant A only. */
  disbursement: { id: string; paidDate: string } | null;
  /** Every fee string seeded above (not the student label or the class name). */
  strings: string[];
  /** Every fee row id seeded above. */
  ids: string[];
}

/** One row on every fees surface for one student, all named after `tag`. */
export async function seedFeesData(
  request: APIRequestContext,
  p: Persona,
  tag: string,
  prefix = 'FE',
): Promise<SeededFeesData> {
  const student = await createStudent(request, p, tag, prefix === 'FE' ? 'Fe' : 'Feb');
  const tenantA = p.tenantId === TENANT_A;
  const klass = tenantA ? await createClass(request, p, tag) : null;
  const due = utcDate(-10);
  const planName = `${prefix} plan ${tag}`;
  const planCode = `${prefix}-P${tag}`;
  const plan = await send<{ id: string }>(request, p, 'POST', '/fees/plans', {
    name: planName,
    code: planCode,
    amountCents: 123_456,
    frequency: 'term',
  });
  const planInvoice = await send<FeeInvoice>(request, p, 'POST', '/fees/invoices', {
    studentId: student.id,
    planId: plan.id,
    dueAt: due,
  });
  const planPaid = await pay(request, p, planInvoice.id, 100_005, `${prefix}-RB-${tag}`);
  const structureName = `${prefix} tuition ${tag}`;
  const structureCode = `${prefix}-S${tag}`;
  const term = `${prefix}-T1-${tag}`;
  const { structure, invoice: structureInv } = await structureInvoice(request, p, {
    name: structureName,
    code: structureCode,
    term,
    amountCents: 99_999,
    studentId: student.id,
    ...(klass ? { classId: klass.id } : {}),
    dueAt: due,
    institutionId: tenantA ? INSTITUTION_A : null,
  });
  const structurePaid = await pay(request, p, structureInv.id, 99, `${prefix}-UPI-${tag}`, 'upi');
  const filename = `${prefix.toLowerCase()}-read-${tag}.csv`;
  const missing = `${prefix}-NOPE-${tag}`;
  const imported = await send<{ batch: { id: string } }>(
    request,
    p,
    'POST',
    '/fees/reconciliation/import',
    {
      csv: `invoiceNumber,amountCents\n${structureInv.invoiceNumber},99999\n${missing},1234`,
      filename,
    },
  );
  const reason = `${prefix} hold ${tag}`;
  const suppression = await send<{ id: string }>(
    request,
    p,
    'POST',
    '/fees/reminders/suppressions',
    {
      invoiceId: planInvoice.id,
      reason,
    },
  );
  const paidDate = utcDate(0);
  let disbursement: SeededFeesData['disbursement'] = null;
  if (tenantA) {
    const scheduled = await scheduledDisbursement(request, p, student.id, 250.5, tag);
    markDisbursementPaidUndelivered(scheduled.id, p.tenantId, paidDate, `${prefix}-TX-${tag}`);
    disbursement = { id: scheduled.id, paidDate };
  }
  return {
    tag,
    student,
    klass,
    plan: { id: plan.id, name: planName, code: planCode },
    planInvoice,
    planReceipt: planPaid.receipt,
    structure: { id: structure.id, name: structureName, code: structureCode, term },
    structureInvoice: structureInv,
    structureReceipt: structurePaid.receipt,
    batch: { id: imported.batch.id, filename, missing },
    suppression: { id: suppression.id, reason },
    disbursement,
    strings: [
      planName,
      planCode,
      planInvoice.invoiceNumber,
      structureName,
      structureCode,
      term,
      structureInv.invoiceNumber,
      planPaid.receipt.receiptNumber,
      structurePaid.receipt.receiptNumber,
      filename,
      missing,
      reason,
    ],
    ids: [
      plan.id,
      planInvoice.id,
      structure.id,
      structureInv.id,
      planPaid.receipt.id,
      structurePaid.receipt.id,
      imported.batch.id,
      suppression.id,
      ...(disbursement ? [disbursement.id] : []),
    ],
  };
}

/** Undo what `seedFeesData` leaves open: suppression, nettable disbursement, overdue dues. */
export async function cleanupFeesData(
  request: APIRequestContext,
  p: Persona,
  d: SeededFeesData,
): Promise<void> {
  await send(
    request,
    p,
    'DELETE',
    `/fees/reminders/suppressions/${d.suppression.id}`,
    undefined,
    204,
  );
  if (d.disbursement) await cancelDisbursement(request, p, d.disbursement.id);
  await settle(request, p, [d.planInvoice.id, d.structureInvoice.id]);
}

/** The nine fees screens (routes under apps/web/src/app/(dashboard)/fees). */
export const FEES_ROUTES = [
  '/fees',
  '/fees/plans',
  '/fees/invoices',
  '/fees/receipts',
  '/fees/structures',
  '/fees/reports',
  '/fees/reconciliation',
  '/fees/scholarship-netting',
  '/fees/dunning',
] as const;

/**
 * Exactly one node for `locator` that is enabled. `next start` can briefly stream a
 * duplicate unhydrated node during the client swap, so wait on the count first (the
 * strict-mode violation does not retry); see 39-fees-structures-write-smoke.spec.ts.
 */
export async function ready(locator: Locator): Promise<Locator> {
  await expect(async () => {
    await expect(locator).toHaveCount(1, { timeout: 2_000 });
    await expect(locator).toBeEnabled({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return locator;
}

/** Exactly one `[data-testid=testId]` node with `data-hydrated="true"`. */
export async function hydrated(page: Page, testId: string): Promise<Locator> {
  const el = page.getByTestId(testId);
  await expect(async () => {
    await expect(el).toHaveCount(1, { timeout: 2_000 });
    await expect(el).toHaveAttribute('data-hydrated', 'true', { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return el;
}

/**
 * Choose `value` in an EntitySearchSelect (`presentation: 'select'`). The picker shows at
 * most 50 options, so filter by the unique `search` text first.
 */
export async function pick(
  scope: Page | Locator,
  selectId: string,
  search: string,
  value: string,
): Promise<void> {
  await scope.locator(`#${selectId}-search`).fill(search);
  const select = scope.locator(`#${selectId}`);
  await expect(select.locator(`option[value="${value}"]`)).toHaveCount(1);
  await select.selectOption(value);
}

/** Soft-assert none of `strings` is in the page HTML (rendered DOM and RSC payload). */
export async function expectNotInPage(page: Page, where: string, strings: string[]): Promise<void> {
  const html = await page.content();
  for (const s of strings) {
    expect.soft(html, `${where}: "${s}" must not be sent to the browser`).not.toContain(s);
  }
}
