/**
 * Staff + parent fees client — `/fees` on the gateway (G-903).
 */
import { GatewayError, gatewayFetch } from './gateway';
import {
  classifyListFailure,
  fetchList,
  type ListFailureKind,
  type ListResult,
} from './list-result';

export interface FeePlan {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string;
  amountCents: number;
  currency: string;
  frequency: string;
  status: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeeInvoice {
  id: string;
  tenantId: string;
  studentId: string;
  planId: string | null;
  title: string;
  description: string;
  amountCents: number;
  currency: string;
  status: string;
  dueAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  invoiceNumber: string | null;
  structureId: string | null;
  classId: string | null;
  gradeId: string | null;
}

export interface FeeReceipt {
  id: string;
  tenantId: string;
  paymentId: string;
  invoiceId: string;
  receiptNumber: string;
  amountCents: number;
  currency: string;
  issuedAt: string;
  createdAt: string;
}

export interface FeeStructure {
  id: string;
  tenantId: string;
  institutionId: string | null;
  academicPeriodId: string | null;
  gradeId: string | null;
  classId: string | null;
  category: string;
  term: string | null;
  code: string;
  name: string;
  amountCents: number;
  currency: string;
  status: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeeInstalment {
  id: string;
  tenantId: string;
  structureId: string;
  sequence: number;
  amountCents: number;
  dueOffsetDays: number;
  label: string;
  createdAt: string;
}

export interface DuesReport {
  asOf: string;
  byClass: Array<{
    classId: string;
    openCount: number;
    overdueCount: number;
    openCents: number;
    overdueCents: number;
  }>;
  byStatus: Array<{ status: string; count: number; amountCents: number }>;
  overdue: Array<{
    invoiceId: string;
    invoiceNumber: string | null;
    studentId: string;
    classId: string | null;
    amountCents: number;
    overdueDays: number;
  }>;
}

export interface CreateFeePlanInput {
  code?: string;
  name: string;
  description?: string;
  amountCents: number;
  currency?: string;
  frequency?: 'once' | 'term' | 'month' | 'year';
}

export interface CreateInvoiceInput {
  studentId: string;
  planId?: string;
  title?: string;
  description?: string;
  amountCents?: number;
  currency?: string;
  dueAt?: string;
}

export interface CreateFeeStructureInput {
  code?: string;
  name: string;
  category: string;
  term?: string;
  amountCents: number;
  currency?: string;
  institutionId?: string;
  academicPeriodId?: string;
  gradeId?: string;
  classId?: string;
  /** PRC-M091: instalments created atomically with the structure. */
  partCount?: number;
}

function throwIfMissing<T>(
  result: { data: T | null; status: number; error?: { code?: string; message?: string } },
  fallback: string,
): T {
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'FEES_ERROR',
      message: result.error?.message ?? fallback,
    });
  }
  return result.data;
}

export function listFeePlansResult(): Promise<ListResult<FeePlan>> {
  return fetchList<FeePlan>('/fees/plans', { next: { revalidate: 0 } });
}

export async function listFeePlans(): Promise<FeePlan[]> {
  const result = await listFeePlansResult();
  if (!result.ok) {
    throw new GatewayError({
      status: result.status,
      code: result.kind,
      message: 'Failed to load fee plans',
    });
  }
  return result.items;
}

export async function createFeePlan(input: CreateFeePlanInput): Promise<FeePlan> {
  const result = await gatewayFetch<FeePlan>('/fees/plans', { method: 'POST', json: input });
  return throwIfMissing(result, 'Failed to create fee plan');
}

export async function listInvoicesResult(
  scope: 'parent' | 'staff' = 'staff',
  filters: { studentId?: string } = {},
): Promise<ListResult<FeeInvoice>> {
  // PRC-M487: studentId is filtered server-side; no client filtering over a tenant-wide list.
  const params = new URLSearchParams();
  if (scope === 'parent') params.set('scope', 'parent');
  if (filters.studentId) params.set('studentId', filters.studentId);
  const qs = params.toString();
  return fetchList<FeeInvoice>(`/fees/invoices${qs ? `?${qs}` : ''}`, {
    next: { revalidate: 0 },
  });
}

export async function listInvoices(
  scope: 'parent' | 'staff' = 'staff',
  filters: { studentId?: string } = {},
): Promise<FeeInvoice[]> {
  const result = await listInvoicesResult(scope, filters);
  if (!result.ok) {
    throw new GatewayError({
      status: result.status,
      code: result.kind,
      message: 'Failed to load invoices',
    });
  }
  return result.items;
}

export async function createInvoice(input: CreateInvoiceInput): Promise<FeeInvoice> {
  const result = await gatewayFetch<FeeInvoice>('/fees/invoices', { method: 'POST', json: input });
  return throwIfMissing(result, 'Failed to create invoice');
}

/** PRC-M477: one bounded page of fee rows (server-side paging + filters). */
export interface FeeListPageQuery {
  page: number;
  pageSize?: number;
  status?: string;
  studentId?: string;
}

function feePageQs(query: FeeListPageQuery): string {
  const qs = new URLSearchParams();
  qs.set('page', String(Math.max(1, Math.floor(query.page) || 1)));
  qs.set('pageSize', String(Math.min(100, Math.max(1, query.pageSize ?? FEE_LIST_PAGE_SIZE))));
  if (query.status) qs.set('status', query.status);
  if (query.studentId) qs.set('studentId', query.studentId);
  return qs.toString();
}

export const FEE_LIST_PAGE_SIZE = 50;

export function listInvoicesPageResult(query: FeeListPageQuery): Promise<ListResult<FeeInvoice>> {
  return fetchList<FeeInvoice>(`/fees/invoices?${feePageQs(query)}`, { next: { revalidate: 0 } });
}

export function listReceiptsPageResult(query: FeeListPageQuery): Promise<ListResult<FeeReceipt>> {
  return fetchList<FeeReceipt>(`/fees/receipts?${feePageQs(query)}`, { next: { revalidate: 0 } });
}

export function listReceiptsResult(
  scope: 'parent' | 'staff' = 'staff',
): Promise<ListResult<FeeReceipt>> {
  const qs = scope === 'parent' ? '?scope=parent' : '';
  return fetchList<FeeReceipt>(`/fees/receipts${qs}`, { next: { revalidate: 0 } });
}

export async function listReceipts(scope: 'parent' | 'staff' = 'staff'): Promise<FeeReceipt[]> {
  const result = await listReceiptsResult(scope);
  if (!result.ok) {
    throw new GatewayError({
      status: result.status,
      code: result.kind,
      message: 'Failed to load receipts',
    });
  }
  return result.items;
}

export function listFeeStructuresResult(): Promise<ListResult<FeeStructure>> {
  return fetchList<FeeStructure>('/fees/structures', { next: { revalidate: 0 } });
}

export async function listFeeStructures(): Promise<FeeStructure[]> {
  const result = await listFeeStructuresResult();
  if (!result.ok) {
    throw new GatewayError({
      status: result.status,
      code: result.kind,
      message: 'Failed to load fee structures',
    });
  }
  return result.items;
}

export async function createFeeStructure(input: CreateFeeStructureInput): Promise<FeeStructure> {
  const result = await gatewayFetch<FeeStructure>('/fees/structures', {
    method: 'POST',
    json: input,
  });
  return throwIfMissing(result, 'Failed to create fee structure');
}

export async function generateInstalments(
  structureId: string,
  partCount: number,
): Promise<FeeInstalment[]> {
  const result = await gatewayFetch<{ data: FeeInstalment[] }>(
    `/fees/structures/${encodeURIComponent(structureId)}/instalments`,
    { method: 'POST', json: { partCount } },
  );
  return throwIfMissing(result, 'Failed to generate instalments').data;
}

export function listInstalmentsResult(structureId: string): Promise<ListResult<FeeInstalment>> {
  return fetchList<FeeInstalment>(
    `/fees/structures/${encodeURIComponent(structureId)}/instalments`,
    {
      next: { revalidate: 0 },
    },
  );
}

export async function listInstalments(structureId: string): Promise<FeeInstalment[]> {
  const result = await listInstalmentsResult(structureId);
  if (!result.ok) {
    throw new GatewayError({
      status: result.status,
      code: result.kind,
      message: 'Failed to load instalments',
    });
  }
  return result.items;
}

export async function bulkInvoiceStructure(
  structureId: string,
  input: { classId?: string; gradeId?: string; studentIds?: string[]; dueAt?: string },
): Promise<{ created: FeeInvoice[]; skipped: string[] }> {
  const result = await gatewayFetch<{ created: FeeInvoice[]; skipped: string[] }>(
    `/fees/structures/${encodeURIComponent(structureId)}/bulk-invoice`,
    { method: 'POST', json: input },
  );
  return throwIfMissing(result, 'Failed to bulk invoice');
}

/** PRC-M086: dry-run count + total for the bulk-invoice confirm dialog. */
export interface BulkInvoicePreview {
  structureId: string;
  studentCount: number;
  toCreateCount: number;
  skippedCount: number;
  totalAmountCents: number;
  currency: string;
}
export async function previewBulkInvoiceStructure(
  structureId: string,
  input: { classId?: string; gradeId?: string; studentIds?: string[] },
): Promise<BulkInvoicePreview> {
  const result = await gatewayFetch<BulkInvoicePreview>(
    `/fees/structures/${encodeURIComponent(structureId)}/bulk-invoice/preview`,
    { method: 'POST', json: input },
  );
  return throwIfMissing(result, 'Failed to preview bulk invoice');
}

/** PRC-H058: gateway Idempotency-Key header for money mutations. */
export interface MoneyMutationOptions {
  idempotencyKey?: string;
}

function idempotencyHeaders(options?: MoneyMutationOptions): Record<string, string> | undefined {
  return options?.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : undefined;
}

export async function applyConcession(
  input: {
    studentId: string;
    structureId: string;
    invoiceId?: string;
    kind: 'percent' | 'amount';
    percent?: number;
    amountCents?: number;
    reason: string;
  },
  options?: MoneyMutationOptions,
): Promise<{ discountCents: number; invoice: FeeInvoice | null }> {
  const result = await gatewayFetch<{
    discountCents: number;
    invoice: FeeInvoice | null;
  }>('/fees/concessions', { method: 'POST', json: input, headers: idempotencyHeaders(options) });
  return throwIfMissing(result, 'Failed to apply concession');
}

export async function refundInvoice(
  invoiceId: string,
  input: { amountCents: number; reason: string },
  options?: MoneyMutationOptions,
): Promise<{ id: string; amountCents: number }> {
  const result = await gatewayFetch<{ id: string; amountCents: number }>(
    `/fees/invoices/${encodeURIComponent(invoiceId)}/refund`,
    { method: 'POST', json: input, headers: idempotencyHeaders(options) },
  );
  return throwIfMissing(result, 'Failed to record refund');
}

export type DuesReportResult =
  { ok: true; report: DuesReport } | { ok: false; kind: ListFailureKind; status: number };

export async function fetchDuesReportResult(): Promise<DuesReportResult> {
  const result = await gatewayFetch<DuesReport>('/fees/reports/dues', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  if (!result.ok || !result.data) {
    if (result.ok) {
      return {
        ok: true,
        report: {
          asOf: new Date().toISOString(),
          byClass: [],
          byStatus: [],
          overdue: [],
        },
      };
    }
    return { ok: false, kind: classifyListFailure(result.status), status: result.status };
  }
  return { ok: true, report: result.data };
}

export async function fetchDuesReport(): Promise<DuesReport> {
  const result = await fetchDuesReportResult();
  if (!result.ok) {
    throw new GatewayError({
      status: result.status,
      code: result.kind,
      message: 'Failed to load the dues report',
    });
  }
  return result.report;
}

export async function importReconciliation(
  csv: string,
  filename?: string,
): Promise<{
  batch: FeeReconciliationBatch;
  matched: Array<{ invoiceNumber: string }>;
  unmatched: Array<{ invoiceNumber: string; note: string }>;
}> {
  const result = await gatewayFetch<{
    batch: FeeReconciliationBatch;
    matched: Array<{ invoiceNumber: string }>;
    unmatched: Array<{ invoiceNumber: string; note: string }>;
  }>('/fees/reconciliation/import', { method: 'POST', json: { csv, filename } });
  return throwIfMissing(result, 'Failed to import reconciliation');
}

export type ReconExceptionStatus = 'none' | 'open' | 'resolved' | 'ignored';

export interface FeeReconciliationBatch {
  id: string;
  tenantId: string;
  filename: string;
  matchedCount: number;
  unmatchedCount: number;
  createdBy: string | null;
  createdAt: string;
}

export interface FeeReconciliationRow {
  id: string;
  tenantId: string;
  batchId: string;
  invoiceNumber: string;
  amountCents: number;
  matched: boolean;
  invoiceId: string | null;
  note: string | null;
  exceptionStatus: ReconExceptionStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

export async function listReconciliationBatches(): Promise<FeeReconciliationBatch[]> {
  const result = await gatewayFetch<{ data: FeeReconciliationBatch[] }>(
    '/fees/reconciliation/batches',
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function listReconciliationRows(batchId: string): Promise<FeeReconciliationRow[]> {
  const result = await gatewayFetch<{ data: FeeReconciliationRow[] }>(
    `/fees/reconciliation/batches/${encodeURIComponent(batchId)}/rows`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function resolveReconciliationException(
  rowId: string,
  input: { status: 'resolved' | 'ignored'; resolutionNote: string },
): Promise<FeeReconciliationRow> {
  const result = await gatewayFetch<FeeReconciliationRow>(
    `/fees/reconciliation/rows/${encodeURIComponent(rowId)}/resolve`,
    { method: 'POST', json: input },
  );
  return throwIfMissing(result, 'Failed to resolve reconciliation exception');
}

/**
 * PRC-M065 / PRC-M089: record a staff-collected payment (method, partial
 * amount, reference) with a client idempotency key so a double submit pays
 * once. Only fields the gateway's `PayInvoiceSchema` accepts are sent.
 */
export interface RecordInvoicePaymentInput {
  method: 'cash' | 'upi' | 'card' | 'sandbox';
  amountCents: number;
  idempotencyKey: string;
  /** UPI transaction id / card approval code / receipt-book number (1–100 chars). */
  reference?: string;
}

export async function recordInvoicePayment(
  invoiceId: string,
  input: RecordInvoicePaymentInput,
): Promise<FeeInvoice> {
  const reference = input.reference?.trim();
  const result = await gatewayFetch<{ invoice: FeeInvoice }>(
    `/fees/invoices/${encodeURIComponent(invoiceId)}/pay`,
    {
      method: 'POST',
      json: {
        method: input.method,
        amountCents: input.amountCents,
        idempotencyKey: input.idempotencyKey,
        ...(reference ? { reference } : {}),
      },
      // PRC-H058: the same key also drives the gateway idempotency plugin.
      headers: idempotencyHeaders({ idempotencyKey: input.idempotencyKey }),
    },
  );
  return throwIfMissing(result, 'Failed to record payment').invoice;
}

/** G-1 / F1 — credit an open invoice (or reserve credit) from a paid scholarship disbursement. */
export interface FeeConcession {
  id: string;
  tenantId: string;
  studentId: string;
  structureId: string;
  invoiceId: string | null;
  kind: 'percent' | 'amount';
  percent: number | null;
  amountCents: number | null;
  reason: string;
  approverId: string | null;
  status: string;
  createdBy: string | null;
  createdAt: string;
}

export interface ApplyScholarshipNettingInput {
  studentId: string;
  disbursementId: string;
  /** PRC-H020: omitted — the gateway credits the verified disbursement amount. */
  amountCents?: number;
  invoiceId?: string;
  currency?: string;
}

export interface ScholarshipNettingResult {
  concession: FeeConcession;
  invoice: FeeInvoice | null;
  discountCents: number;
  idempotent: boolean;
}

/** PRC-H020 — paid scholarship disbursements not yet netted (verified server-side). */
export interface NettableScholarshipDisbursement {
  id: string;
  tenantId: string;
  studentId: string;
  amountCents: number;
  paymentStatus: string;
  currency?: string | null;
  paidDate?: string | null;
}

export async function listNettableScholarshipDisbursementsResult(): Promise<
  ListResult<NettableScholarshipDisbursement>
> {
  return fetchList<NettableScholarshipDisbursement>('/fees/scholarships/nettable-disbursements', {
    next: { revalidate: 0 },
  });
}

export async function applyScholarshipNetting(
  input: ApplyScholarshipNettingInput,
  options?: MoneyMutationOptions,
): Promise<ScholarshipNettingResult> {
  const result = await gatewayFetch<ScholarshipNettingResult>('/fees/scholarships/net', {
    method: 'POST',
    json: input,
    headers: idempotencyHeaders(options),
  });
  return throwIfMissing(result, 'Failed to apply scholarship netting');
}

/** F2 — overdue reminder feed row (GET /fees/reminders/overdue). */
export interface OverdueReminderRow {
  invoiceId: string;
  invoiceNumber: string | null;
  studentId: string;
  classId: string | null;
  amountCents: number;
  currency: string;
  dueAt: string;
  overdueDays: number;
  suppressed: boolean;
}

export interface ReminderSuppression {
  id: string;
  tenantId: string;
  studentId: string | null;
  invoiceId: string | null;
  reason: string;
  createdBy: string;
  createdAt: string;
}

export interface ReminderSendAudit {
  id: string;
  tenantId: string;
  invoiceId: string;
  studentId: string;
  channel: 'email' | 'sms';
  messageId: string;
  mode: 'sandbox';
  honestyNote: string;
  actorId: string;
  createdAt: string;
}

export interface SendRemindersInput {
  invoiceIds: string[];
  channels: Array<'email' | 'sms'>;
  minOverdueDays?: number;
  cadenceDays?: number;
}

export interface SendRemindersResult {
  mode: 'sandbox';
  honestyNote: string;
  results: Array<{
    invoiceId: string;
    studentId: string;
    channel: 'email' | 'sms';
    messageId: string | null;
    suppressed: boolean;
    skippedReason?: string;
    auditId?: string;
  }>;
}

export async function listOverdueReminders(asOf?: string): Promise<{
  data: OverdueReminderRow[];
  asOf: string;
}> {
  const qs = asOf ? `?asOf=${encodeURIComponent(asOf)}` : '';
  const result = await gatewayFetch<{ data: OverdueReminderRow[]; asOf: string }>(
    `/fees/reminders/overdue${qs}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return {
    data: result.data?.data ?? [],
    asOf: result.data?.asOf ?? new Date().toISOString(),
  };
}

export async function listReminderSuppressions(): Promise<ReminderSuppression[]> {
  const result = await gatewayFetch<{ data: ReminderSuppression[] }>(
    '/fees/reminders/suppressions',
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function addReminderSuppression(input: {
  studentId?: string;
  invoiceId?: string;
  reason: string;
}): Promise<ReminderSuppression> {
  const result = await gatewayFetch<ReminderSuppression>('/fees/reminders/suppressions', {
    method: 'POST',
    json: input,
  });
  return throwIfMissing(result, 'Failed to add reminder suppression');
}

export async function removeReminderSuppression(id: string): Promise<void> {
  const result = await gatewayFetch<null>(
    `/fees/reminders/suppressions/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      throwOnError: false,
    },
  );
  if (result.status >= 400) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'FEES_ERROR',
      message: result.error?.message ?? 'Failed to remove suppression',
    });
  }
}

export async function listReminderSendAudits(): Promise<{
  data: ReminderSendAudit[];
  honestyNote: string;
}> {
  const result = await gatewayFetch<{ data: ReminderSendAudit[]; honestyNote: string }>(
    '/fees/reminders/audit',
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return {
    data: result.data?.data ?? [],
    honestyNote:
      result.data?.honestyNote ?? 'Sandbox fee reminders — no live Twilio/SES claim (G-709).',
  };
}

export async function sendFeeReminders(input: SendRemindersInput): Promise<SendRemindersResult> {
  const result = await gatewayFetch<SendRemindersResult>('/fees/reminders/send', {
    method: 'POST',
    json: input,
  });
  return throwIfMissing(result, 'Failed to send fee reminders');
}
