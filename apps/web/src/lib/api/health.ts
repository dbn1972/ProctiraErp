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

/** PHI access log viewer — matches HealthService.listPhiAccessLogs privileged roles. */
export function canAccessPhiAccessLogs(roles: Array<{ roleName: string }>): boolean {
  return roles.some((role) => {
    const n = role.roleName.toLowerCase();
    return (
      n.includes('health_admin') ||
      n.includes('health_officer') ||
      n.includes('system_admin') ||
      n.includes('administrator') ||
      n === 'super_admin' ||
      n === 'health_admin' ||
      n === 'health_officer'
    );
  });
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
  const result = await gatewayFetch<{ data: SpecialNeedRecord[] }>('/health/special-needs', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function listCounsellingSessions(): Promise<CounsellingSession[]> {
  const result = await gatewayFetch<{ data: CounsellingSession[] }>('/health/counselling', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

/**
 * Creates a counselling session via the in-process health domain plugin
 * (`POST /health/counselling/sessions`). Throws GatewayError on failure.
 */
export async function createCounsellingSession(
  input: CreateCounsellingSessionInput,
): Promise<CreatedCounsellingSession> {
  const result = await gatewayFetch<CreatedCounsellingSession>('/health/counselling/sessions', {
    method: 'POST',
    json: input,
  });
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
  const result = await gatewayFetch<{ data: ScreeningProgram[] }>('/health/screenings', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export interface AllergyRecord {
  id: string;
  tenantId: string;
  studentId: string;
  allergyType: string;
  description: string;
  severity: string;
  reaction: string | null;
  treatment: string | null;
  diagnosedDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAllergyInput {
  studentId: string;
  allergyType: string;
  description: string;
  severity: 'mild' | 'moderate' | 'severe' | 'life-threatening';
  reaction?: string;
  treatment?: string;
  diagnosedDate?: string;
}

export interface VaccinationRecord {
  id: string;
  tenantId: string;
  studentId: string;
  vaccineName: string;
  doseNumber: number;
  dateAdministered: string;
  administeredBy: string | null;
  batchNumber: string | null;
  nextDueDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateVaccinationInput {
  studentId: string;
  vaccineName: string;
  doseNumber: number;
  dateAdministered: string;
  administeredBy?: string;
  batchNumber?: string;
  nextDueDate?: string;
  notes?: string;
}

export interface PhiAccessLogRow {
  id: string;
  tenantId: string;
  actorUserId: string;
  studentId: string;
  resourceType: string;
  resourceId: string | null;
  action: string;
  createdAt: string;
}

export interface NurseIncidentRecord {
  id: string;
  tenantId: string;
  studentId: string;
  institutionId: string | null;
  incidentAt: string;
  category: string;
  severity: string;
  notes: string;
  reportedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNurseIncidentInput {
  studentId: string;
  institutionId?: string;
  incidentAt: string;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  notes?: string;
  reportedBy: string;
}

export async function listStudentAllergies(studentId: string): Promise<AllergyRecord[]> {
  const result = await gatewayFetch<{ data: AllergyRecord[] }>(
    `/health/allergies/student/${studentId}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function createAllergy(input: CreateAllergyInput): Promise<AllergyRecord> {
  const result = await gatewayFetch<AllergyRecord>('/health/allergies', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create allergy',
    });
  }
  return result.data;
}

export async function listStudentVaccinations(studentId: string): Promise<VaccinationRecord[]> {
  const result = await gatewayFetch<{ data: VaccinationRecord[] }>(
    `/health/vaccinations/student/${studentId}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

/** Tenant-wide immunisation register (Wave 10 Option B). */
export async function listVaccinations(): Promise<VaccinationRecord[]> {
  const result = await gatewayFetch<{ data: VaccinationRecord[] }>('/health/vaccinations', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function createVaccination(input: CreateVaccinationInput): Promise<VaccinationRecord> {
  const result = await gatewayFetch<VaccinationRecord>('/health/vaccinations', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create vaccination',
    });
  }
  return result.data;
}

export async function listPhiAccessLogs(studentId?: string): Promise<{
  rows: PhiAccessLogRow[];
  accessDenied: boolean;
}> {
  const qs = studentId ? `?studentId=${encodeURIComponent(studentId)}` : '';
  const result = await gatewayFetch<{ data: PhiAccessLogRow[] }>(`/health/phi-access${qs}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  if (result.status === 401 || result.status === 403 || result.status === 422) {
    return { rows: [], accessDenied: true };
  }
  return { rows: result.data?.data ?? [], accessDenied: false };
}

export async function listNurseIncidents(): Promise<NurseIncidentRecord[]> {
  const result = await gatewayFetch<{ data: NurseIncidentRecord[] }>('/health/incidents', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function createNurseIncident(
  input: CreateNurseIncidentInput,
): Promise<NurseIncidentRecord> {
  const result = await gatewayFetch<NurseIncidentRecord>('/health/incidents', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create incident',
    });
  }
  return result.data;
}
