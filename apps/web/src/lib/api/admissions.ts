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
