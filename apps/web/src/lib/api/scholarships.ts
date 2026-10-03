/**
 * Scholarship service client.
 *
 * Validates: Requirement 11.1 — scholarship programs, applications,
 * approvals, and disbursements.
 */
import { GatewayError, gatewayFetch } from './gateway';
import { fetchList, type ListResult } from './list-result';

/** PRC-M113/M114: server-side filters + paging for scholarship lists. */
export interface ScholarshipListParams {
  page?: number;
  pageSize?: number;
  status?: string;
  search?: string;
  programId?: string;
  paymentStatus?: string;
}

function listQuery(params: ScholarshipListParams): string {
  const q = new URLSearchParams();
  q.set('page', String(Math.max(1, Math.floor(params.page ?? 1))));
  q.set('pageSize', String(Math.min(100, Math.max(1, Math.floor(params.pageSize ?? 20)))));
  for (const key of ['status', 'search', 'programId', 'paymentStatus'] as const) {
    const value = params[key];
    if (value) q.set(key, value);
  }
  return `?${q.toString()}`;
}

function mapList<T>(
  result: ListResult<Record<string, unknown>>,
  map: (raw: Record<string, unknown>) => T,
): ListResult<T> {
  return result.ok ? { ...result, items: result.items.map(map) } : result;
}

/** PRC-M113: 404 -> null (not found); any other failure is an error, not "missing". */
function throwUnlessNotFound(
  result: { status: number; error?: { code?: string; message?: string } | null },
  what: string,
): null {
  if (result.status === 404) return null;
  throw new GatewayError({
    status: result.status,
    code: result.error?.code ?? 'GATEWAY_ERROR',
    message: result.error?.message ?? `Failed to load ${what} (${result.status})`,
  });
}

export interface ScholarshipProgram {
  id: string;
  name: string;
  code: string;
  totalSlots: number;
  awardAmount: number;
  currency: string;
  applicationStartDate: string;
  applicationEndDate: string;
  status: 'DRAFT' | 'OPEN' | 'CLOSED' | 'ARCHIVED';
  description?: string | null;
}

export interface ScholarshipApplication {
  id: string;
  applicantName: string;
  applicantId: string;
  programId: string;
  programName: string;
  submittedAt: string;
  status: 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
  totalScore?: number | null;
  /** ISO timestamp of the approve / reject decision (G-911). */
  reviewedAt: string | null;
  reviewerId: string | null;
  reviewNotes: string | null;
}

export interface ApplicationDecisionInput {
  comment?: string;
  /** Approve only — queue the first instalment today (gateway default: true). */
  scheduleFirstDisbursement?: boolean;
}

export interface ScholarshipDisbursement {
  id: string;
  applicationId: string;
  applicantName: string;
  programName: string;
  amount: number;
  currency: string;
  paymentDate: string;
  paymentMethod: 'BANK_TRANSFER' | 'CHEQUE' | 'CASH';
  status: 'SCHEDULED' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'CANCELLED';
}

export interface CreateScholarshipProgramInput {
  name: string;
  code?: string;
  description?: string;
  applicationStartDate: string;
  applicationEndDate: string;
  totalSlots: number;
  awardAmount: number;
  currency?: string;
  eligibilityNotes?: string;
}

export interface UpdateScholarshipProgramInput {
  name?: string;
  description?: string;
  applicationStartDate?: string;
  applicationEndDate?: string;
  totalSlots?: number;
  amountPerRecipient?: number;
  currency?: string;
  status?: 'draft' | 'open' | 'closed' | 'archived';
}

export interface UpdateDisbursementInput {
  paymentStatus: 'scheduled' | 'processing' | 'paid' | 'failed' | 'cancelled';
  paidDate?: string;
  transactionReference?: string;
  notes?: string;
}

function slugCode(name: string, fallback?: string): string {
  if (fallback && fallback.trim()) return fallback.trim().toUpperCase();
  return (
    name
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'PROGRAM'
  );
}

function mapProgram(raw: Record<string, unknown>): ScholarshipProgram {
  const name = String(raw.name ?? '');
  const description = (raw.description as string | null | undefined) ?? null;
  const codeFromDescription = description?.match(/Code:\s*([A-Z0-9-]+)/i)?.[1];
  return {
    id: String(raw.id ?? ''),
    name,
    code: slugCode(name, String(raw.code ?? codeFromDescription ?? '')),
    totalSlots: Number(raw.totalSlots ?? 0),
    awardAmount: Number(raw.awardAmount ?? raw.amountPerRecipient ?? 0),
    currency: String(raw.currency ?? 'INR'),
    applicationStartDate: String(raw.applicationStartDate ?? '').slice(0, 10),
    applicationEndDate: String(raw.applicationEndDate ?? '').slice(0, 10),
    status: String(raw.status ?? 'DRAFT').toUpperCase() as ScholarshipProgram['status'],
    description,
  };
}

function mapApplication(raw: Record<string, unknown>): ScholarshipApplication {
  const statusRaw = String(raw.status ?? 'PENDING')
    .toUpperCase()
    .replace(/-/g, '_');
  let status: ScholarshipApplication['status'] = 'PENDING';
  if (statusRaw === 'UNDER_REVIEW' || statusRaw === 'SUBMITTED') status = 'UNDER_REVIEW';
  else if (statusRaw === 'APPROVED') status = 'APPROVED';
  else if (statusRaw === 'REJECTED') status = 'REJECTED';

  return {
    id: String(raw.id ?? ''),
    applicantName: String(raw.applicantName ?? raw.studentName ?? 'Applicant'),
    applicantId: String(raw.applicantId ?? raw.studentId ?? ''),
    programId: String(raw.programId ?? ''),
    programName: String(raw.programName ?? '—'),
    submittedAt: String(raw.submittedAt ?? raw.createdAt ?? '').slice(0, 10),
    status,
    totalScore:
      raw.totalScore === null || raw.totalScore === undefined ? null : Number(raw.totalScore),
    reviewedAt: raw.reviewedAt ? String(raw.reviewedAt) : null,
    reviewerId: raw.reviewerId ? String(raw.reviewerId) : null,
    reviewNotes: raw.reviewNotes ? String(raw.reviewNotes) : null,
  };
}

/** PRC-M111: every backend payment status keeps its own meaning. */
const DISBURSEMENT_STATUS: Record<string, ScholarshipDisbursement['status']> = {
  scheduled: 'SCHEDULED',
  processing: 'PROCESSING',
  paid: 'PROCESSED',
  processed: 'PROCESSED',
  failed: 'FAILED',
  cancelled: 'CANCELLED',
  canceled: 'CANCELLED',
};

export function mapDisbursement(raw: Record<string, unknown>): ScholarshipDisbursement {
  const paymentStatus = String(raw.status ?? raw.paymentStatus ?? 'scheduled').toLowerCase();
  const status: ScholarshipDisbursement['status'] =
    DISBURSEMENT_STATUS[paymentStatus] ?? 'SCHEDULED';

  return {
    id: String(raw.id ?? ''),
    applicationId: String(raw.applicationId ?? ''),
    applicantName: String(raw.applicantName ?? raw.recipientName ?? '—'),
    programName: String(raw.programName ?? '—'),
    amount: Number(raw.amount ?? 0),
    currency: String(raw.currency ?? 'INR'),
    paymentDate: String(raw.paymentDate ?? raw.scheduledDate ?? '').slice(0, 10),
    paymentMethod: String(raw.paymentMethod ?? 'BANK_TRANSFER')
      .toUpperCase()
      .replace('BANK_TRANSFER', 'BANK_TRANSFER') as ScholarshipDisbursement['paymentMethod'],
    status,
  };
}

export async function listScholarshipPrograms(
  params: ScholarshipListParams = {},
): Promise<ListResult<ScholarshipProgram>> {
  const result = await fetchList<Record<string, unknown>>(
    `/scholarships/programs${listQuery({ pageSize: 100, ...params })}`,
    { next: { revalidate: 0 } },
  );
  return mapList(result, mapProgram);
}

export async function getScholarshipProgram(id: string): Promise<ScholarshipProgram | null> {
  const result = await gatewayFetch<Record<string, unknown>>(`/scholarships/programs/${id}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  if (result.ok && result.data) return mapProgram(result.data);
  return throwUnlessNotFound(result, 'scholarship program');
}

export async function createScholarshipProgram(
  input: CreateScholarshipProgramInput,
): Promise<ScholarshipProgram> {
  const description = [
    input.code ? `Code: ${input.code}` : null,
    input.description,
    input.eligibilityNotes,
  ]
    .filter(Boolean)
    .join('\n');

  const result = await gatewayFetch<Record<string, unknown>>('/scholarships/programs', {
    method: 'POST',
    json: {
      name: input.name,
      description: description || undefined,
      applicationStartDate: input.applicationStartDate,
      applicationEndDate: input.applicationEndDate,
      totalSlots: input.totalSlots,
      amountPerRecipient: input.awardAmount,
      currency: input.currency ?? 'INR',
      eligibility: {},
    },
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create scholarship program',
    });
  }
  return mapProgram({ ...result.data, code: input.code ?? result.data['code'] });
}

export async function updateScholarshipProgram(
  id: string,
  input: UpdateScholarshipProgramInput,
): Promise<ScholarshipProgram> {
  const result = await gatewayFetch<Record<string, unknown>>(`/scholarships/programs/${id}`, {
    method: 'PUT',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'UPDATE_FAILED',
      message: result.error?.message ?? 'Failed to update scholarship program',
    });
  }
  return mapProgram(result.data);
}

export async function listScholarshipApplications(
  params: ScholarshipListParams = {},
): Promise<ListResult<ScholarshipApplication>> {
  const result = await fetchList<Record<string, unknown>>(
    `/scholarships/applications${listQuery(params)}`,
    { next: { revalidate: 0 } },
  );
  return mapList(result, mapApplication);
}

export async function getScholarshipApplication(
  id: string,
): Promise<ScholarshipApplication | null> {
  const result = await gatewayFetch<Record<string, unknown>>(`/scholarships/applications/${id}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  if (result.ok && result.data) return mapApplication(result.data);
  return throwUnlessNotFound(result, 'scholarship application');
}

async function decideApplication(
  id: string,
  decision: 'approve' | 'reject',
  input: ApplicationDecisionInput,
): Promise<ScholarshipApplication> {
  const result = await gatewayFetch<Record<string, unknown>>(
    `/scholarships/applications/${encodeURIComponent(id)}/${decision}`,
    { method: 'POST', json: input, throwOnError: false },
  );
  if (!result.ok || !result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'DECISION_FAILED',
      message: result.error?.message ?? `Failed to ${decision} application`,
    });
  }
  return mapApplication(result.data);
}

/** `POST /scholarships/applications/:id/approve` — reviewer comes from the session JWT. */
export function approveScholarshipApplication(id: string, input: ApplicationDecisionInput = {}) {
  return decideApplication(id, 'approve', input);
}

/** `POST /scholarships/applications/:id/reject` */
export function rejectScholarshipApplication(id: string, input: ApplicationDecisionInput = {}) {
  return decideApplication(id, 'reject', input);
}

export async function listScholarshipDisbursements(
  params: ScholarshipListParams = {},
): Promise<ListResult<ScholarshipDisbursement>> {
  const result = await fetchList<Record<string, unknown>>(
    `/scholarships/disbursements${listQuery(params)}`,
    { next: { revalidate: 0 } },
  );
  return mapList(result, mapDisbursement);
}

export async function updateDisbursement(
  id: string,
  input: UpdateDisbursementInput,
): Promise<ScholarshipDisbursement> {
  const result = await gatewayFetch<Record<string, unknown>>(`/scholarships/disbursements/${id}`, {
    method: 'PUT',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'UPDATE_FAILED',
      message: result.error?.message ?? 'Failed to update disbursement',
    });
  }
  return mapDisbursement(result.data);
}

/** PRC-M111: money totals grouped per currency (never summed across currencies). */
export function totalsByCurrency(
  rows: ReadonlyArray<{ amount: number; currency: string }>,
): Array<{ currency: string; total: number }> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const currency = row.currency || 'INR';
    totals.set(currency, (totals.get(currency) ?? 0) + row.amount);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, total]) => ({ currency, total }));
}
