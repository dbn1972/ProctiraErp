/**
 * Admissions CRM API client.
 */
import { GatewayError, gatewayFetch } from './gateway';

export interface AdmissionApplication {
  id: string;
  tenantId: string;
  trackingNumber: string;
  institutionId: string;
  institutionName: string;
  status: string;
  firstName: string;
  lastName: string;
  submittedAt: string;
  updatedAt: string;
  remarks: string | null;
}

export interface WaitlistEntry {
  id: string;
  applicationId: string;
  institutionId: string;
  position: number;
  notes: string | null;
  createdAt: string;
}

export interface InterviewSlot {
  id: string;
  institutionId: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  location: string | null;
  status: string;
}

export async function listApplications(): Promise<AdmissionApplication[]> {
  const result = await gatewayFetch<{ data: AdmissionApplication[] }>(
    '/registrations/applications',
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function updateApplicationStatus(
  id: string,
  status: 'pending' | 'under_review' | 'approved' | 'rejected' | 'waitlisted',
  remarks?: string,
): Promise<void> {
  const result = await gatewayFetch(`/registrations/applications/${id}/status`, {
    method: 'POST',
    json: { status, remarks },
  });
  if (!result.data && result.status >= 400) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'STATUS_FAILED',
      message: result.error?.message ?? 'Failed to update status',
    });
  }
}

export async function listWaitlist(institutionId?: string): Promise<WaitlistEntry[]> {
  const qs = institutionId ? `?institutionId=${encodeURIComponent(institutionId)}` : '';
  const result = await gatewayFetch<{ data: WaitlistEntry[] }>(`/registrations/waitlist${qs}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function listInterviewSlots(institutionId?: string): Promise<InterviewSlot[]> {
  const qs = institutionId ? `?institutionId=${encodeURIComponent(institutionId)}` : '';
  const result = await gatewayFetch<{ data: InterviewSlot[] }>(
    `/registrations/interview-slots${qs}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function createInterviewSlot(input: {
  institutionId: string;
  startsAt: string;
  endsAt: string;
  capacity?: number;
  location?: string;
}): Promise<InterviewSlot> {
  const result = await gatewayFetch<InterviewSlot>('/registrations/interview-slots', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'SLOT_FAILED',
      message: result.error?.message ?? 'Failed to create interview slot',
    });
  }
  return result.data;
}

export async function bookInterview(input: {
  slotId: string;
  applicationId: string;
}): Promise<{ id: string }> {
  const result = await gatewayFetch<{ id: string }>('/registrations/interview-bookings', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'BOOK_FAILED',
      message: result.error?.message ?? 'Failed to book interview',
    });
  }
  return result.data;
}

export interface AdmissionEnquiry {
  id: string;
  institutionId: string;
  academicPeriodId: string;
  gradeId: string;
  quota: string;
  source: string;
  stage: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  guardianName: string;
  guardianPhone: string;
  applicationId: string | null;
  interviewScore: number | null;
  testScore: number | null;
  createdAt: string;
}

export interface EnquiryFollowup {
  id: string;
  enquiryId: string;
  dueAt: string;
  ownerId: string | null;
  notes: string;
  status: string;
}

export interface SeatMatrixRow {
  id: string;
  institutionId: string;
  academicPeriodId: string;
  gradeId: string;
  quota: string;
  seats: number;
  filled: number;
  available: number;
}

export interface MeritListEntry {
  id: string;
  applicationId: string;
  rank: number;
  score: number;
  interviewScore: number;
  testScore: number;
  firstName: string | null;
  lastName: string | null;
}

export interface MeritList {
  id: string;
  institutionId: string;
  academicPeriodId: string;
  gradeId: string;
  interviewWeight: number;
  testWeight: number;
  generatedAt: string;
  entries: MeritListEntry[];
}

export interface AdmissionOffer {
  id: string;
  applicationId: string;
  status: string;
  feeAmount: number;
  feeCurrency: string;
  paymentRef: string | null;
  offerFeeInvoiceId: string | null;
  enrolledStudentId: string | null;
  expiresAt: string | null;
  offerDocument: Record<string, unknown>;
}

export interface ApplicationBundle {
  application: AdmissionApplication & { dateOfBirth?: string; gender?: string };
  placement: {
    academicPeriodId: string;
    gradeId: string;
    quota: string;
    interviewScore: number;
    testScore: number;
  } | null;
  enquiry: AdmissionEnquiry | null;
  offers: AdmissionOffer[];
}

export async function listEnquiries(): Promise<AdmissionEnquiry[]> {
  const result = await gatewayFetch<{ data: AdmissionEnquiry[] }>('/admissions/enquiries', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function createEnquiry(input: {
  institutionId: string;
  academicPeriodId: string;
  gradeId: string;
  quota?: string;
  source?: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender?: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail?: string;
  interviewScore?: number;
  testScore?: number;
  notes?: string;
}): Promise<AdmissionEnquiry> {
  const result = await gatewayFetch<AdmissionEnquiry>('/admissions/enquiries', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'ENQUIRY_FAILED',
      message: result.error?.message ?? 'Failed to create enquiry',
    });
  }
  return result.data;
}

export async function updateEnquiry(
  id: string,
  input: { stage?: string; interviewScore?: number; testScore?: number },
): Promise<void> {
  const result = await gatewayFetch(`/admissions/enquiries/${id}`, {
    method: 'PATCH',
    json: input,
  });
  if (result.status >= 400) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'ENQUIRY_UPDATE_FAILED',
      message: result.error?.message ?? 'Failed to update enquiry',
    });
  }
}

export async function addEnquiryFollowup(
  id: string,
  input: { dueAt: string; ownerId?: string; notes?: string },
): Promise<EnquiryFollowup> {
  const result = await gatewayFetch<EnquiryFollowup>(`/admissions/enquiries/${id}/follow-ups`, {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'FOLLOWUP_FAILED',
      message: result.error?.message ?? 'Failed to add follow-up',
    });
  }
  return result.data;
}

export async function convertEnquiry(
  id: string,
): Promise<{ enquiry: AdmissionEnquiry; application: AdmissionApplication }> {
  const result = await gatewayFetch<{
    enquiry: AdmissionEnquiry;
    application: AdmissionApplication;
  }>(`/admissions/enquiries/${id}/convert`, { method: 'POST' });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CONVERT_FAILED',
      message: result.error?.message ?? 'Failed to convert enquiry',
    });
  }
  return result.data;
}

export async function listSeatMatrix(filter?: {
  institutionId?: string;
  academicPeriodId?: string;
}): Promise<SeatMatrixRow[]> {
  const qs = new URLSearchParams();
  if (filter?.institutionId) qs.set('institutionId', filter.institutionId);
  if (filter?.academicPeriodId) qs.set('academicPeriodId', filter.academicPeriodId);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const result = await gatewayFetch<{ data: SeatMatrixRow[] }>(`/admissions/seat-matrix${suffix}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function upsertSeatMatrix(input: {
  institutionId: string;
  academicPeriodId: string;
  gradeId: string;
  quota?: string;
  seats: number;
}): Promise<SeatMatrixRow> {
  const result = await gatewayFetch<SeatMatrixRow>('/admissions/seat-matrix', {
    method: 'PUT',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'SEAT_FAILED',
      message: result.error?.message ?? 'Failed to save seat matrix',
    });
  }
  return result.data;
}

export async function generateMeritList(input: {
  institutionId: string;
  academicPeriodId: string;
  gradeId: string;
  interviewWeight: number;
  testWeight: number;
}): Promise<MeritList> {
  const result = await gatewayFetch<MeritList>('/admissions/merit-lists', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'MERIT_FAILED',
      message: result.error?.message ?? 'Failed to generate merit list',
    });
  }
  return result.data;
}

export async function getMeritList(input: {
  institutionId: string;
  academicPeriodId: string;
  gradeId: string;
}): Promise<MeritList | null> {
  const qs = new URLSearchParams(input);
  const result = await gatewayFetch<MeritList>(`/admissions/merit-lists?${qs.toString()}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data ?? null;
}

export async function getApplicationBundle(id: string): Promise<ApplicationBundle | null> {
  const result = await gatewayFetch<ApplicationBundle>(`/admissions/applications/${id}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data ?? null;
}

export async function createAdmissionOffer(input: {
  applicationId: string;
  feeAmount?: number;
  expiresAt?: string;
}): Promise<AdmissionOffer> {
  const result = await gatewayFetch<AdmissionOffer>('/admissions/offers', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'OFFER_FAILED',
      message: result.error?.message ?? 'Failed to create offer',
    });
  }
  return result.data;
}

export async function sendAdmissionOffer(id: string): Promise<AdmissionOffer> {
  const result = await gatewayFetch<AdmissionOffer>(`/admissions/offers/${id}/send`, {
    method: 'POST',
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'SEND_FAILED',
      message: result.error?.message ?? 'Failed to send offer',
    });
  }
  return result.data;
}

export async function acceptAdmissionOffer(
  id: string,
  input: { paymentRef: string; offerFeeInvoiceId?: string },
): Promise<AdmissionOffer> {
  const result = await gatewayFetch<AdmissionOffer>(`/admissions/offers/${id}/accept`, {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'ACCEPT_FAILED',
      message: result.error?.message ?? 'Failed to accept offer',
    });
  }
  return result.data;
}

export async function declineAdmissionOffer(id: string): Promise<AdmissionOffer> {
  const result = await gatewayFetch<AdmissionOffer>(`/admissions/offers/${id}/decline`, {
    method: 'POST',
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'DECLINE_FAILED',
      message: result.error?.message ?? 'Failed to decline offer',
    });
  }
  return result.data;
}
