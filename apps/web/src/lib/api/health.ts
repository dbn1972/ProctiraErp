/**
 * Health service client.
 *
 * Validates: Requirement 12.1 — health records, special needs, counselling,
 * screenings.
 *
 * Access control: Backend health-service enforces role-based access. Pages
 * call requireSession() and pass the access token through gatewayFetch.
 */
import { GatewayError, gatewayFetch } from './gateway';

export interface HealthRecord {
  id: string;
  studentId: string;
  studentName: string;
  bloodType?: string | null;
  allergies?: string[];
  chronicConditions?: string[];
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  lastUpdated: string;
}

export interface SpecialNeedRecord {
  id: string;
  studentId: string;
  studentName: string;
  category: string;
  severity: 'MILD' | 'MODERATE' | 'SEVERE';
  accommodations: string[];
  iepActive: boolean;
}

export interface CounsellingSession {
  id: string;
  studentId: string;
  studentName: string;
  counsellorName: string;
  sessionDate: string;
  topic: string;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
}

/** Domain create payload for POST /health/counselling/sessions. */
export interface CreateCounsellingSessionInput {
  studentId: string;
  counsellorId: string;
  sessionDate: string;
  sessionType: 'individual' | 'group' | 'family' | 'crisis';
  reason: string;
  caseNotes: string;
  outcome?: string;
  followUpRequired: boolean;
  followUpDate?: string;
  status: 'scheduled' | 'completed' | 'cancelled' | 'no-show';
}

/** Domain entity returned by POST /health/counselling/sessions. */
export interface CreatedCounsellingSession {
  id: string;
  tenantId: string;
  studentId: string;
  counsellorId: string;
  sessionDate: string;
  sessionType: string;
  reason: string;
  caseNotes: string;
  outcome: string | null;
  followUpRequired: boolean;
  followUpDate: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScreeningProgram {
  id: string;
  name: string;
  description?: string | null;
  gradeLevel: string;
  assessmentTypes: string[];
  scheduledDate?: string | null;
  status: string;
}

/**
 * Returns true when the user has the role required to access health records.
 * Accepts UI enum names and backend snake_case roles.
 */
export function canAccessHealthRecords(roles: Array<{ roleName: string }>): boolean {
  const allowed = new Set([
    'HEALTH_OFFICER',
    'NURSE',
    'HEALTH_ADMIN',
    'SUPER_ADMIN',
    'SYSTEM_ADMIN',
    'COUNSELLOR',
    'health_officer',
    'school_nurse',
    'health_admin',
    'system_admin',
    'counsellor',
  ]);
  return roles.some((role) => allowed.has(role.roleName));
}

export async function listHealthRecords(): Promise<HealthRecord[]> {
  const result = await gatewayFetch<{ data: HealthRecord[] }>('/health/records', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function getHealthRecord(studentId: string): Promise<HealthRecord | null> {
  const result = await gatewayFetch<HealthRecord>(`/health/records/${studentId}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data;
}

export async function listSpecialNeeds(): Promise<SpecialNeedRecord[]> {
  const result = await gatewayFetch<{ data: SpecialNeedRecord[] }>(
    '/health/special-needs',
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function listCounsellingSessions(): Promise<CounsellingSession[]> {
  const result = await gatewayFetch<{ data: CounsellingSession[] }>(
    '/health/counselling',
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

/**
 * Creates a counselling session via the in-process health domain plugin
 * (`POST /health/counselling/sessions`). Throws GatewayError on failure.
 */
export async function createCounsellingSession(
  input: CreateCounsellingSessionInput,
): Promise<CreatedCounsellingSession> {
  const result = await gatewayFetch<CreatedCounsellingSession>(
    '/health/counselling/sessions',
    { method: 'POST', json: input },
  );
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create counselling session',
    });
  }
  return result.data;
}

export async function listScreeningPrograms(): Promise<ScreeningProgram[]> {
  const result = await gatewayFetch<{ data: ScreeningProgram[] }>(
    '/health/screenings',
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}
