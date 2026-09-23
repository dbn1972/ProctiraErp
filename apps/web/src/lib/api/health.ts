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
import { fetchList, itemsOrEmpty, type ListResult } from './list-result';

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
 * Health personnel cleared to read health records.
 *
 * Compared case-insensitively against the whole `roleName`, never as a substring:
 * `canAccessPhiAccessLogs` used substring matching and that is the bug this file's
 * tests now pin. Listed lowercase; callers normalise.
 */
const HEALTH_RECORD_ROLES = new Set([
  'health_officer',
  'nurse',
  'school_nurse',
  'health_admin',
  'super_admin',
  'system_admin',
  'counsellor',
]);

/**
 * Roles cleared to read the PHI *access log* — the register of who looked at a
 * child's health data. Deliberately a strict subset of {@link HEALTH_RECORD_ROLES}:
 * a nurse or counsellor may treat a student without being able to audit colleagues.
 *
 * `super_admin` is here because the gateway's health plugin canonicalises a
 * `SUPER_ADMIN` JWT role to `system_admin` before the health service sees it
 * (`apps/api-gateway/src/health-ui-plugin.ts`), so the API serves that user. Dropping it
 * from this set would deny the page to someone the API answers — a silent disagreement
 * between the two gates, which is the class of bug this file is being fixed for.
 */
const PHI_ACCESS_LOG_ROLES = new Set([
  'health_admin',
  'health_officer',
  'system_admin',
  'super_admin',
]);

/**
 * Returns true when the user has the role required to access health records.
 * Accepts UI enum names and backend snake_case roles.
 */
export function canAccessHealthRecords(roles: Array<{ roleName: string }>): boolean {
  return roles.some((role) => HEALTH_RECORD_ROLES.has(role.roleName.toLowerCase()));
}

/**
 * PHI access log viewer — mirrors `HealthService.listPhiAccessLogs`.
 *
 * This used `roleName.includes('administrator')` and `includes('health_officer')`,
 * which inverted the intended hierarchy: the *stricter* gate was the looser one.
 * `Administrator` and `Super Administrator` — two roles shipped in `DEFAULT_ROLES`,
 * neither of which appears in the health-records allow-list — matched
 * `includes('administrator')` and could read the PHI access log. So could
 * `library_administrator`, `canteen_administrator`, `former_health_officer` and
 * `trainee_health_officer`. Whole-value matching only.
 *
 * (`Super Administrator` does hold `{ resource: '*', action: 'manage' }` in coarse RBAC,
 * so it is denied here by omission from the health allow-list rather than by an explicit
 * rule. The inversion stands either way: the audit trail was reachable while the records
 * it audits were not.)
 */
export function canAccessPhiAccessLogs(roles: Array<{ roleName: string }>): boolean {
  return roles.some((role) => PHI_ACCESS_LOG_ROLES.has(role.roleName.toLowerCase()));
}

/**
 * Read the health-records list, preserving *why* it is empty.
 *
 * Reference conversion for the `throwOnError: false` + `?? []` pattern (see
 * `lib/api/list-result.ts`). Health is where the collapse did the most damage: the web
 * guard and the health service disagreed about which role names are cleared, so a
 * genuinely authorized user was refused by the service and the page said "no records"
 * instead of reporting the denial.
 */
export async function listHealthRecordsResult(): Promise<ListResult<HealthRecord>> {
  return fetchList<HealthRecord>('/health/records', { next: { revalidate: 0 } });
}

/** @deprecated Prefer {@link listHealthRecordsResult}; this renders a denial as empty. */
export async function listHealthRecords(): Promise<HealthRecord[]> {
  return itemsOrEmpty(await listHealthRecordsResult());
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
