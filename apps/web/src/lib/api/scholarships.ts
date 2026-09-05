/**
 * Scholarship service client.
 *
 * Validates: Requirement 11.1 — scholarship programs, applications,
 * approvals, and disbursements.
 */
import { GatewayError, gatewayFetch } from './gateway';

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
  status: 'SCHEDULED' | 'PROCESSED' | 'FAILED';
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
      raw.totalScore === null || raw.totalScore === undefined
        ? null
        : Number(raw.totalScore),
  };
}

function mapDisbursement(raw: Record<string, unknown>): ScholarshipDisbursement {
  const paymentStatus = String(raw.status ?? raw.paymentStatus ?? 'SCHEDULED').toLowerCase();
  let status: ScholarshipDisbursement['status'] = 'SCHEDULED';
  if (paymentStatus === 'paid' || paymentStatus === 'processed') status = 'PROCESSED';
  else if (paymentStatus === 'failed') status = 'FAILED';

  return {
    id: String(raw.id ?? ''),
    applicationId: String(raw.applicationId ?? ''),
    applicantName: String(raw.applicantName ?? raw.recipientName ?? '—'),
    programName: String(raw.programName ?? '—'),
    amount: Number(raw.amount ?? 0),
    currency: String(raw.currency ?? 'INR'),
    paymentDate: String(raw.paymentDate ?? raw.scheduledDate ?? '').slice(0, 10),
    paymentMethod: String(
      raw.paymentMethod ?? 'BANK_TRANSFER',
    )
      .toUpperCase()
      .replace('BANK_TRANSFER', 'BANK_TRANSFER') as ScholarshipDisbursement['paymentMethod'],
    status,
  };
}

export async function listScholarshipPrograms(): Promise<ScholarshipProgram[]> {
  const result = await gatewayFetch<{ data: Record<string, unknown>[] }>(
    '/scholarships/programs',
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return (result.data?.data ?? []).map(mapProgram);
}

export async function getScholarshipProgram(id: string): Promise<ScholarshipProgram | null> {
  const result = await gatewayFetch<Record<string, unknown>>(`/scholarships/programs/${id}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data ? mapProgram(result.data) : null;
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

export async function listScholarshipApplications(): Promise<ScholarshipApplication[]> {
  const result = await gatewayFetch<{ data: Record<string, unknown>[] }>(
    '/scholarships/applications',
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return (result.data?.data ?? []).map(mapApplication);
}

export async function getScholarshipApplication(
  id: string,
): Promise<ScholarshipApplication | null> {
  const result = await gatewayFetch<Record<string, unknown>>(
    `/scholarships/applications/${id}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data ? mapApplication(result.data) : null;
}

export async function listScholarshipDisbursements(): Promise<ScholarshipDisbursement[]> {
  const result = await gatewayFetch<{ data: Record<string, unknown>[] }>(
    '/scholarships/disbursements',
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return (result.data?.data ?? []).map(mapDisbursement);
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
