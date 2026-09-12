/**
 * Staff + parent fees client — `/fees` on the gateway (G-903).
 */
import { GatewayError, gatewayFetch } from './gateway';

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

export async function listFeePlans(): Promise<FeePlan[]> {
  const result = await gatewayFetch<{ data: FeePlan[] }>('/fees/plans', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function createFeePlan(input: CreateFeePlanInput): Promise<FeePlan> {
  const result = await gatewayFetch<FeePlan>('/fees/plans', { method: 'POST', json: input });
  return throwIfMissing(result, 'Failed to create fee plan');
}

export async function listInvoices(
  scope: 'parent' | 'staff' = 'staff',
  filters: { studentId?: string } = {},
): Promise<FeeInvoice[]> {
  const qs = scope === 'parent' ? '?scope=parent' : '';
  const result = await gatewayFetch<{ data: FeeInvoice[] }>(`/fees/invoices${qs}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  const invoices = result.data?.data ?? [];
  if (filters.studentId) {
    return invoices.filter((inv) => inv.studentId === filters.studentId);
  }
  return invoices;
}

export async function createInvoice(input: CreateInvoiceInput): Promise<FeeInvoice> {
  const result = await gatewayFetch<FeeInvoice>('/fees/invoices', { method: 'POST', json: input });
  return throwIfMissing(result, 'Failed to create invoice');
}

export async function listReceipts(scope: 'parent' | 'staff' = 'staff'): Promise<FeeReceipt[]> {
  const qs = scope === 'parent' ? '?scope=parent' : '';
  const result = await gatewayFetch<{ data: FeeReceipt[] }>(`/fees/receipts${qs}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function listFeeStructures(): Promise<FeeStructure[]> {
  const result = await gatewayFetch<{ data: FeeStructure[] }>('/fees/structures', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
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
    `/fees/structures/${structureId}/instalments`,
    { method: 'POST', json: { partCount } },
  );
  return throwIfMissing(result, 'Failed to generate instalments').data;
}

export async function bulkInvoiceStructure(
  structureId: string,
  input: { classId?: string; gradeId?: string; studentIds?: string[]; dueAt?: string },
): Promise<{ created: FeeInvoice[]; skipped: string[] }> {
  const result = await gatewayFetch<{ created: FeeInvoice[]; skipped: string[] }>(
    `/fees/structures/${structureId}/bulk-invoice`,
    { method: 'POST', json: input },
  );
  return throwIfMissing(result, 'Failed to bulk invoice');
}

export async function applyConcession(input: {
  studentId: string;
  structureId: string;
  invoiceId?: string;
  kind: 'percent' | 'amount';
  percent?: number;
  amountCents?: number;
  reason: string;
}): Promise<{ discountCents: number; invoice: FeeInvoice | null }> {
  const result = await gatewayFetch<{
    discountCents: number;
    invoice: FeeInvoice | null;
  }>('/fees/concessions', { method: 'POST', json: input });
  return throwIfMissing(result, 'Failed to apply concession');
}

export async function refundInvoice(
  invoiceId: string,
  input: { amountCents: number; reason: string },
): Promise<{ id: string; amountCents: number }> {
  const result = await gatewayFetch<{ id: string; amountCents: number }>(
    `/fees/invoices/${invoiceId}/refund`,
    { method: 'POST', json: input },
  );
  return throwIfMissing(result, 'Failed to record refund');
}

export async function fetchDuesReport(): Promise<DuesReport> {
  const result = await gatewayFetch<DuesReport>('/fees/reports/dues', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return (
    result.data ?? {
      asOf: new Date().toISOString(),
      byClass: [],
      byStatus: [],
      overdue: [],
    }
  );
}

export async function importReconciliation(
  csv: string,
  filename?: string,
): Promise<{
  matched: Array<{ invoiceNumber: string }>;
  unmatched: Array<{ invoiceNumber: string; note: string }>;
}> {
  const result = await gatewayFetch<{
    matched: Array<{ invoiceNumber: string }>;
    unmatched: Array<{ invoiceNumber: string; note: string }>;
  }>('/fees/reconciliation/import', { method: 'POST', json: { csv, filename } });
  return throwIfMissing(result, 'Failed to import reconciliation');
}

export async function recordInvoicePayment(invoiceId: string): Promise<FeeInvoice> {
  const result = await gatewayFetch<{ invoice: FeeInvoice }>(`/fees/invoices/${invoiceId}/pay`, {
    method: 'POST',
    json: { method: 'sandbox' },
  });
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
  amountCents: number;
  invoiceId?: string;
  currency?: string;
}

export interface ScholarshipNettingResult {
  concession: FeeConcession;
  invoice: FeeInvoice | null;
  discountCents: number;
  idempotent: boolean;
}

export async function applyScholarshipNetting(
  input: ApplyScholarshipNettingInput,
): Promise<ScholarshipNettingResult> {
  const result = await gatewayFetch<ScholarshipNettingResult>('/fees/scholarships/net', {
    method: 'POST',
    json: input,
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
  const result = await gatewayFetch<null>(`/fees/reminders/suppressions/${id}`, {
    method: 'DELETE',
    throwOnError: false,
  });
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
