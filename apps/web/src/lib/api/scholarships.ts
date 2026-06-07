/**
 * Scholarship service client.
 *
 * Validates: Requirement 11.1 — scholarship programs, applications,
 * approvals, and disbursements.
 */
import { gatewayFetch } from './gateway';

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

export async function listScholarshipPrograms(): Promise<ScholarshipProgram[]> {
  const result = await gatewayFetch<{ data: ScholarshipProgram[] }>(
    '/scholarships/programs',
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function getScholarshipProgram(id: string): Promise<ScholarshipProgram | null> {
  const result = await gatewayFetch<ScholarshipProgram>(
    `/scholarships/programs/${id}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data;
}

export async function listScholarshipApplications(): Promise<ScholarshipApplication[]> {
  const result = await gatewayFetch<{ data: ScholarshipApplication[] }>(
    '/scholarships/applications',
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function getScholarshipApplication(
  id: string,
): Promise<ScholarshipApplication | null> {
  const result = await gatewayFetch<ScholarshipApplication>(
    `/scholarships/applications/${id}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data;
}

export async function listScholarshipDisbursements(): Promise<ScholarshipDisbursement[]> {
  const result = await gatewayFetch<{ data: ScholarshipDisbursement[] }>(
    '/scholarships/disbursements',
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}
