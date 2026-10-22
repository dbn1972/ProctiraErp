/**
 * Health Service
 *
 * Business logic for health-related operations including measurements,
 * allergies, conditions, vaccinations, insurance, special needs,
 * counselling, and screening programs.
 *
 * Requirements:
 * - 12.1: Record student health data
 * - 12.2: Track special needs assessments, diagnoses, referrals, accommodation plans
 * - 12.3: Manage counselling sessions with case notes, follow-ups, outcome tracking
 * - 12.4: Restrict access to authorized health personnel and student's guardian
 * - 12.5: Support configurable health screening programs per grade level
 */
import { NotFoundError, BusinessRuleError, ForbiddenError } from '@proctira/common';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import type { PgQueryable } from '@proctira/database';
import { v4 as uuidv4 } from 'uuid';

import type {
  HealthRepository,
  HealthMeasurementEntity,
  AllergyEntity,
  HealthConditionEntity,
  VaccinationEntity,
  InsuranceEntity,
  SpecialNeedsAssessmentEntity,
  DiagnosisEntity,
  ReferralEntity,
  AccommodationPlanEntity,
  CounsellingSessionEntity,
  ScreeningProgramEntity,
  NurseIncidentEntity,
} from './health-repository.js';
import { BreakGlassNotPendingError } from './pg-break-glass-store.js';
import type { PhiAccessLogInput } from './pg-special-needs-store.js';
import { assertNotPhiCiphertextInput } from './phi-crypto.js';
import {
  PHI_FIELD_COUNSELLING_CASE_NOTES,
  PHI_FIELD_REDACTED,
  HEALTH_BREAK_GLASS_DEFAULT_MINUTES,
  HEALTH_BREAK_GLASS_MAX_MINUTES,
  applyCounsellingCaseNotesAcl,
  canApproveHealthBreakGlass,
  isHealthPhiFieldPath,
  type HealthBreakGlassGrant,
  type HealthPhiFieldPath,
} from './phi-field-acl.js';
import { recordPhiReadAudit } from './phi-read-audit.js';
import type {
  CreateMeasurementInput,
  UpdateMeasurementInput,
  CreateAllergyInput,
  UpdateAllergyInput,
  CreateConditionInput,
  UpdateConditionInput,
  CreateVaccinationInput,
  UpdateVaccinationInput,
  CreateInsuranceInput,
  UpdateInsuranceInput,
  CreateSpecialNeedsAssessmentInput,
  CreateDiagnosisInput,
  CreateReferralInput,
  UpdateReferralInput,
  CreateAccommodationPlanInput,
  UpdateAccommodationPlanInput,
  CreateCounsellingSessionInput,
  UpdateCounsellingSessionInput,
  CreateScreeningProgramInput,
  UpdateScreeningProgramInput,
  CreateHealthBreakGlassRequestInput,
} from './schemas.js';

type PhiAccessCapableRepository = HealthRepository & {
  logPhiAccess?: (input: PhiAccessLogInput) => Promise<void>;
  listPhiAccessLogs?: (
    tenantId: string,
    options?: { studentId?: string; limit?: number },
  ) => Promise<
    Array<{
      id: string;
      tenantId: string;
      actorUserId: string;
      studentId: string;
      resourceType: string;
      resourceId: string | null;
      action: string;
      breakGlassId: string | null;
      createdAt: string;
    }>
  >;
  createBreakGlassGrant?: (
    input: {
      tenantId: string;
      requesterUserId: string;
      studentId: string;
      fieldPath: HealthPhiFieldPath;
      justification: string;
      durationMinutes: number;
    },
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: HealthBreakGlassGrant) => Promise<void>;
    },
  ) => Promise<HealthBreakGlassGrant>;
  findBreakGlassGrantById?: (id: string, tenantId: string) => Promise<HealthBreakGlassGrant | null>;
  findActiveBreakGlassGrant?: (
    tenantId: string,
    requesterUserId: string,
    studentId: string,
    fieldPath: HealthPhiFieldPath,
    now?: Date,
  ) => Promise<HealthBreakGlassGrant | null>;
  approveBreakGlassGrant?: (
    id: string,
    tenantId: string,
    approverUserId: string,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: HealthBreakGlassGrant) => Promise<void>;
    },
  ) => Promise<HealthBreakGlassGrant | null>;
  denyBreakGlassGrant?: (
    id: string,
    tenantId: string,
    approverUserId: string,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: HealthBreakGlassGrant) => Promise<void>;
    },
  ) => Promise<HealthBreakGlassGrant | null>;
  listBreakGlassGrants?: (
    tenantId: string,
    options?: { studentId?: string; limit?: number },
  ) => Promise<HealthBreakGlassGrant[]>;
};

/**
 * User context for access control checks.
 * Requirement 12.4: Restrict access to authorized health personnel and student's guardian.
 */
export interface HealthAccessContext {
  userId: string;
  roles: string[];
  /** Guardian student IDs — students this user is a guardian of */
  guardianOfStudentIds: string[];
  /**
   * JWT institution claims (hint). Prefer {@link authoritativeInstitutionIds}
   * when resolved from staff assignments (W1-SEC-04 COMPLETE).
   */
  institutionIds?: string[];
  /**
   * Authoritative actor institution assignments from staff_assignments (or
   * test seed). When set (including `[]`), JWT claims are ignored for scope.
   * `undefined` means not resolved yet — fall back to JWT, still deny if empty
   * for non-tenant-wide roles.
   */
  authoritativeInstitutionIds?: string[];
  /**
   * Purpose of the PHI access (field ACL / audit). Case notes require a
   * treatment-class purpose or an active break-glass grant.
   */
  purpose?: HealthPhiAccessPurpose;
}

export type HealthPhiAccessPurpose =
  'treatment' | 'care_coordination' | 'breakglass' | 'admin' | 'dsar' | 'audit';

export interface HealthAccessOptions {
  /** Active enrollment institution for the student (from enrollments lookup). */
  studentInstitutionId?: string | null;
}

/** Roles that are authorized to access health records */
const HEALTH_AUTHORIZED_ROLES = [
  'health_officer',
  'school_nurse',
  'health_admin',
  'system_admin',
  'counsellor',
];

export const TENANT_WIDE_HEALTH_ROLES = ['health_admin', 'system_admin'] as const;

/**
 * Roles cleared to read the PHI *access log* — the register of who looked at a child's
 * health data. A strict subset of {@link HEALTH_AUTHORIZED_ROLES}: a nurse or counsellor
 * may treat a student without being able to audit colleagues.
 *
 * Matched against the whole role name, case-insensitively. `listPhiAccessLogs` used
 * `roleName.includes('administrator')`, which inverted the hierarchy this list
 * describes — the stricter gate became the looser one. `Administrator` and
 * `Super Administrator`, both shipped in `DEFAULT_ROLES` and neither present in
 * `HEALTH_AUTHORIZED_ROLES`, matched it; so did `library_administrator`,
 * `canteen_administrator`, `former_health_officer` and `trainee_health_officer`. Every
 * other check in this file already matched whole values; this one was the exception.
 */
const PHI_ACCESS_LOG_ROLES = ['health_admin', 'health_officer', 'system_admin'] as const;

/**
 * Whole-value, case-insensitive membership — the single comparison every health role
 * list in this file uses.
 *
 * Three reasons it is one function rather than four inline `.includes(role)` calls:
 *
 *   • Substring matching is how `listPhiAccessLogs` came to grant `Administrator`
 *     access to the PHI audit trail. There is now one place that could regress.
 *   • The lists must agree on case or the subset relationship between them breaks.
 *     With `PHI_ACCESS_LOG_ROLES` normalising and `HEALTH_AUTHORIZED_ROLES` not,
 *     `HEALTH_ADMIN` passed the PHI audit gate and failed every record gate — the
 *     stricter gate being the looser one again, moved from the substring axis to the
 *     case axis.
 *   • On the HTTP path `health-ui-plugin` canonicalises JWT roles to lowercase
 *     snake_case before the service sees them, so normalising here is a no-op in
 *     production. It matters for callers that build a `HealthAccessContext` directly:
 *     jobs, other services, tests.
 */
function hasHealthRole(roles: readonly string[], allowed: readonly string[]): boolean {
  return roles.some((role) => allowed.includes(role.toLowerCase()));
}

const CASE_NOTES_PURPOSES: readonly HealthPhiAccessPurpose[] = [
  'treatment',
  'care_coordination',
  'breakglass',
  'dsar',
];

/** Tenant-wide health admins may omit institution scope. */
export function isTenantWideHealthActor(context: HealthAccessContext): boolean {
  return hasHealthRole(context.roles, TENANT_WIDE_HEALTH_ROLES);
}

/**
 * Effective institution IDs: authoritative assignments win when present.
 */
export function effectiveInstitutionIds(context: HealthAccessContext): string[] {
  if (context.authoritativeInstitutionIds !== undefined) {
    return context.authoritativeInstitutionIds.filter(Boolean);
  }
  return (context.institutionIds ?? []).filter(Boolean);
}

/**
 * School-bound when the actor has a health role that is not tenant-wide admin.
 * Missing institution scope denies access (does not elevate to tenant-wide).
 */
export function isSchoolBoundHealthActor(context: HealthAccessContext): boolean {
  if (isTenantWideHealthActor(context)) return false;
  return hasHealthRole(context.roles, HEALTH_AUTHORIZED_ROLES);
}

/** Purpose gate for counselling case-notes field ACL (W1-SEC-04). */
export function allowsCounsellingCaseNotesPurpose(
  purpose: HealthPhiAccessPurpose | undefined,
): boolean {
  if (!purpose) return false;
  return (CASE_NOTES_PURPOSES as readonly string[]).includes(purpose);
}

/**
 * Checks if the user has access to a student's health records.
 * Access is granted if:
 * - User is the student's guardian, OR
 * - User has a tenant-wide health admin role, OR
 * - User has an authorized school-bound health role AND student's institution
 *   is in effective (authoritative || JWT) institution assignments
 *
 * W1-SEC-04 COMPLETE: missing institution scope for school-bound roles denies
 * (no silent tenant-wide elevation).
 */
export function hasHealthAccess(
  context: HealthAccessContext,
  studentId: string,
  options: HealthAccessOptions = {},
): boolean {
  const hasAuthorizedRole = hasHealthRole(context.roles, HEALTH_AUTHORIZED_ROLES);

  if (!studentId) {
    // Tenant-wide list surfaces (immunisation register, nurse incidents).
    if (!hasAuthorizedRole) return false;
    return isTenantWideHealthActor(context);
  }

  if (context.guardianOfStudentIds.includes(studentId)) return true;
  if (!hasAuthorizedRole) return false;
  if (isTenantWideHealthActor(context)) return true;

  const institutions = effectiveInstitutionIds(context);
  if (institutions.length === 0) return false;

  const studentInstitutionId = options.studentInstitutionId;
  if (!studentInstitutionId) return false;
  return institutions.includes(studentInstitutionId);
}

/**
 * PRC-L314: write-access gate. Mirrors {@link hasHealthAccess} but does NOT
 * short-circuit true on guardian-of-student — a guardian may read a student's
 * health records but must not be able to create/update/delete them. Goes
 * straight to the role / institution-scope checks.
 */
export function hasHealthWriteAccess(
  context: HealthAccessContext,
  studentId: string,
  options: HealthAccessOptions = {},
): boolean {
  const hasAuthorizedRole = hasHealthRole(context.roles, HEALTH_AUTHORIZED_ROLES);

  if (!studentId) {
    // Tenant-wide list surfaces.
    if (!hasAuthorizedRole) return false;
    return isTenantWideHealthActor(context);
  }

  if (!hasAuthorizedRole) return false;
  if (isTenantWideHealthActor(context)) return true;

  const institutions = effectiveInstitutionIds(context);
  if (institutions.length === 0) return false;

  const studentInstitutionId = options.studentInstitutionId;
  if (!studentInstitutionId) return false;
  return institutions.includes(studentInstitutionId);
}

/**
 * PRC-H006 / PRC-M273: the counselling `reason` (topic) and `outcome` are counselling
 * PHI. Only counsellors — and the student's own guardian — may read them; nurses,
 * health officers and admins get schedule metadata only. Same predicate gates both
 * fields.
 */
export function canReadCounsellingReason(context: HealthAccessContext, studentId: string): boolean {
  if (context.guardianOfStudentIds.includes(studentId)) return true;
  return hasHealthRole(context.roles, ['counsellor']);
}

/**
 * Blank `reason` and `outcome` on sessions the caller may not read them for
 * (see canReadCounsellingReason). PRC-M273: outcome previously leaked to any
 * authorized health role; it now follows the same guardian-or-counsellor gate
 * as reason.
 */
export function redactCounsellingReasons<
  T extends { studentId: string; reason: string; outcome: string | null },
>(context: HealthAccessContext, sessions: T[]): T[] {
  return sessions.map((session) =>
    canReadCounsellingReason(context, session.studentId)
      ? session
      : { ...session, reason: '', outcome: '' },
  );
}

/**
 * PRC-L316 (10b): `^\d{4}-\d{2}-\d{2}$` (the schemas.ts pattern) accepts
 * digit-shaped nonsense like '2024-13-45' or '2024-02-30' — `new Date(...)`
 * on Node is lenient too (it rolls '2024-02-30' forward to March 1 rather
 * than rejecting it). This validates year/month/day ranges explicitly
 * instead of relying on Date parsing, plus an optional lower year bound and
 * future-date rejection (both opt-outable per field via `options`).
 */
export function assertValidCalendarDate(
  value: string,
  fieldName: string,
  options: { allowFuture?: boolean; minYear?: number } = {},
): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new BusinessRuleError(`${fieldName} must be a valid calendar date (YYYY-MM-DD)`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const minYear = options.minYear ?? 1900;
  if (month < 1 || month > 12) {
    throw new BusinessRuleError(`${fieldName} must be a valid calendar date (YYYY-MM-DD)`);
  }
  // Days-in-month via UTC day-0-of-next-month, which also accounts for leap years.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) {
    throw new BusinessRuleError(`${fieldName} must be a valid calendar date (YYYY-MM-DD)`);
  }
  if (year < minYear) {
    throw new BusinessRuleError(`${fieldName} must not be earlier than ${minYear}`);
  }
  if (!options.allowFuture) {
    const todayStr = new Date().toISOString().slice(0, 10);
    if (value > todayStr) {
      throw new BusinessRuleError(`${fieldName} cannot be in the future`);
    }
  }
}

/**
 * Health Service class providing business logic for all health operations.
 */
export class HealthService {
  constructor(private readonly repository: HealthRepository) {}

  private async resolveStudentInstitutionId(
    tenantId: string,
    studentId: string,
  ): Promise<string | null> {
    const lookup = this.repository.findStudentInstitutionId?.bind(this.repository);
    if (!lookup) return null;
    return lookup(tenantId, studentId);
  }

  private async resolveAuthoritativeInstitutions(
    tenantId: string,
    accessContext: HealthAccessContext,
  ): Promise<HealthAccessContext> {
    if (accessContext.authoritativeInstitutionIds !== undefined) return accessContext;
    if (isTenantWideHealthActor(accessContext)) return accessContext;
    const lookup = this.repository.findActorInstitutionAssignments?.bind(this.repository);
    // Lookup function absent entirely: legitimate "not attempted" case, still
    // defers to JWT claims.
    if (!lookup || !accessContext.userId) return accessContext;
    let assigned: string[] | null;
    try {
      assigned = await lookup(tenantId, accessContext.userId);
    } catch {
      // PRC-L312: the lookup was attempted and failed (RLS / schema drift /
      // connection error) — this is NOT "not attempted". A school-bound actor
      // must be denied rather than silently falling back to JWT institution
      // claims; a tenant-wide actor is unaffected (already returned above).
      return { ...accessContext, authoritativeInstitutionIds: [] };
    }
    if (assigned === null) return accessContext;
    return { ...accessContext, authoritativeInstitutionIds: assigned };
  }

  private async assertHealthAccess(
    accessContext: HealthAccessContext,
    studentId: string,
    tenantId?: string,
  ): Promise<void> {
    const effective =
      tenantId != null
        ? await this.resolveAuthoritativeInstitutions(tenantId, accessContext)
        : accessContext;
    const studentInstitutionId =
      studentId && tenantId ? await this.resolveStudentInstitutionId(tenantId, studentId) : null;
    if (!hasHealthAccess(effective, studentId, { studentInstitutionId })) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
  }

  /**
   * PRC-L314/L311: write-access gate. A guardian may read a student's health
   * records but must not be able to write to them or request break-glass —
   * use this instead of {@link assertHealthAccess} at every mutating call site.
   */
  private async assertHealthWriteAccess(
    accessContext: HealthAccessContext,
    studentId: string,
    tenantId?: string,
  ): Promise<void> {
    const effective =
      tenantId != null
        ? await this.resolveAuthoritativeInstitutions(tenantId, accessContext)
        : accessContext;
    const studentInstitutionId =
      studentId && tenantId ? await this.resolveStudentInstitutionId(tenantId, studentId) : null;
    if (!hasHealthWriteAccess(effective, studentId, { studentInstitutionId })) {
      throw new ForbiddenError(
        "Access denied: not authorized to modify this student's health records",
      );
    }
  }

  /**
   * PHI read audit — metadata only (never payloads).
   * W1-SEC-10: fail closed in production when auditor missing/misconfigured
   * unless ALLOW_PHI_AUDIT_DEGRADE=1.
   */
  private async auditPhiRead(
    accessContext: HealthAccessContext,
    input: Omit<PhiAccessLogInput, 'actorUserId'>,
  ): Promise<void> {
    const repo = this.repository as PhiAccessCapableRepository;
    await recordPhiReadAudit({
      logPhiAccess:
        typeof repo.logPhiAccess === 'function' ? (entry) => repo.logPhiAccess!(entry) : null,
      entry: {
        ...input,
        actorUserId: accessContext.userId,
      },
    });
  }

  private async resolveCaseNotesGrant(
    tenantId: string,
    accessContext: HealthAccessContext,
    studentId: string,
  ): Promise<HealthBreakGlassGrant | null> {
    const repo = this.repository as PhiAccessCapableRepository;
    if (typeof repo.findActiveBreakGlassGrant !== 'function') return null;
    return repo.findActiveBreakGlassGrant(
      tenantId,
      accessContext.userId,
      studentId,
      PHI_FIELD_COUNSELLING_CASE_NOTES,
    );
  }

  private async applyCaseNotesFieldAcl(
    tenantId: string,
    accessContext: HealthAccessContext,
    sessions: CounsellingSessionEntity[],
  ): Promise<CounsellingSessionEntity[]> {
    const byStudent = new Map<string, HealthBreakGlassGrant | null>();
    const out: CounsellingSessionEntity[] = [];
    const purposeOk = allowsCounsellingCaseNotesPurpose(accessContext.purpose);
    for (const session of sessions) {
      let grant = byStudent.get(session.studentId);
      if (grant === undefined) {
        grant = await this.resolveCaseNotesGrant(tenantId, accessContext, session.studentId);
        byStudent.set(session.studentId, grant);
      }
      // Purpose controls: unredact only with treatment-class purpose + active grant,
      // or break-glass purpose with an active grant. Missing purpose always redacts
      // unless an active break-glass grant is present (grant implies breakglass purpose).
      const effectiveGrant =
        grant && (purposeOk || accessContext.purpose === undefined) ? grant : null;
      const acl = applyCounsellingCaseNotesAcl(session, effectiveGrant);
      if (!acl.redacted) {
        await this.auditPhiRead(accessContext, {
          tenantId,
          studentId: session.studentId,
          resourceType: 'counselling_session.case_notes',
          resourceId: session.id,
          breakGlassId: acl.breakGlassId,
        });
      }
      out.push(acl.entity);
    }
    return out;
  }

  // ─── Measurements ───────────────────────────────────────────────────────

  async createMeasurement(
    tenantId: string,
    input: CreateMeasurementInput,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: HealthMeasurementEntity) => Promise<void>;
    },
  ): Promise<HealthMeasurementEntity> {
    await this.assertHealthWriteAccess(accessContext, input.studentId, tenantId);
    assertValidCalendarDate(input.date, 'date');
    const entity = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      date: input.date,
      height: input.height ?? null,
      weight: input.weight ?? null,
      bmi: input.bmi ?? null,
      bloodPressureSystolic: input.bloodPressureSystolic ?? null,
      bloodPressureDiastolic: input.bloodPressureDiastolic ?? null,
      heartRate: input.heartRate ?? null,
      visionLeft: input.visionLeft ?? null,
      visionRight: input.visionRight ?? null,
      notes: input.notes ?? null,
    };
    return this.repository.createMeasurement(entity, options);
  }

  async updateMeasurement(
    tenantId: string,
    id: string,
    input: UpdateMeasurementInput,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: HealthMeasurementEntity) => Promise<void>;
    },
  ): Promise<HealthMeasurementEntity> {
    const existing = await this.repository.findMeasurementById(id, tenantId);
    if (!existing) throw new NotFoundError(`Measurement with id '${id}' not found`);
    await this.assertHealthWriteAccess(accessContext, existing.studentId, tenantId);
    if (input.date !== undefined) assertValidCalendarDate(input.date, 'date');
    const updated = await this.repository.updateMeasurement(id, tenantId, input, options);
    if (!updated) throw new NotFoundError(`Measurement with id '${id}' not found`);
    return updated;
  }

  async getMeasurement(
    tenantId: string,
    id: string,
    accessContext: HealthAccessContext,
  ): Promise<HealthMeasurementEntity> {
    const entity = await this.repository.findMeasurementById(id, tenantId);
    if (!entity) throw new NotFoundError(`Measurement with id '${id}' not found`);
    await this.assertHealthAccess(accessContext, entity.studentId, tenantId);
    await this.auditPhiRead(accessContext, {
      tenantId,
      studentId: entity.studentId,
      resourceType: 'measurement',
      resourceId: entity.id,
    });
    return entity;
  }

  async listMeasurements(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
    accessContext: HealthAccessContext,
  ): Promise<PaginatedResult<HealthMeasurementEntity>> {
    await this.assertHealthAccess(accessContext, studentId, tenantId);
    const result = await this.repository.listMeasurementsByStudent(tenantId, studentId, pagination);
    await this.auditPhiRead(accessContext, {
      tenantId,
      studentId,
      resourceType: 'measurement',
      resourceId: null,
    });
    return result;
  }

  async deleteMeasurement(
    tenantId: string,
    id: string,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: HealthMeasurementEntity) => Promise<void>;
    },
  ): Promise<void> {
    const existing = await this.repository.findMeasurementById(id, tenantId);
    if (!existing) throw new NotFoundError(`Measurement with id '${id}' not found`);
    await this.assertHealthWriteAccess(accessContext, existing.studentId, tenantId);
    await this.repository.deleteMeasurement(id, tenantId, options);
  }

  // ─── Allergies ──────────────────────────────────────────────────────────

  async createAllergy(
    tenantId: string,
    input: CreateAllergyInput,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: AllergyEntity) => Promise<void>;
    },
  ): Promise<AllergyEntity> {
    await this.assertHealthWriteAccess(accessContext, input.studentId, tenantId);
    if (input.diagnosedDate != null) assertValidCalendarDate(input.diagnosedDate, 'diagnosedDate');
    const entity = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      allergyType: input.allergyType,
      description: input.description,
      severity: input.severity,
      reaction: input.reaction ?? null,
      treatment: input.treatment ?? null,
      diagnosedDate: input.diagnosedDate ?? null,
    };
    return this.repository.createAllergy(entity, options);
  }

  async updateAllergy(
    tenantId: string,
    id: string,
    input: UpdateAllergyInput,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: AllergyEntity) => Promise<void>;
    },
  ): Promise<AllergyEntity> {
    const existing = await this.repository.findAllergyById(id, tenantId);
    if (!existing) throw new NotFoundError(`Allergy with id '${id}' not found`);
    await this.assertHealthWriteAccess(accessContext, existing.studentId, tenantId);
    if (input.diagnosedDate != null) assertValidCalendarDate(input.diagnosedDate, 'diagnosedDate');
    const updated = await this.repository.updateAllergy(id, tenantId, input, options);
    if (!updated) throw new NotFoundError(`Allergy with id '${id}' not found`);
    return updated;
  }

  /** W1-SEC: allergies had no delete path in the service layer at all. */
  async deleteAllergy(
    tenantId: string,
    id: string,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: AllergyEntity) => Promise<void>;
    },
  ): Promise<void> {
    const existing = await this.repository.findAllergyById(id, tenantId);
    if (!existing) throw new NotFoundError(`Allergy with id '${id}' not found`);
    await this.assertHealthWriteAccess(accessContext, existing.studentId, tenantId);
    await this.repository.deleteAllergy(id, tenantId, options);
  }

  async listAllergies(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
    accessContext: HealthAccessContext,
  ): Promise<PaginatedResult<AllergyEntity>> {
    await this.assertHealthAccess(accessContext, studentId, tenantId);
    const result = await this.repository.listAllergiesByStudent(tenantId, studentId, pagination);
    await this.auditPhiRead(accessContext, {
      tenantId,
      studentId,
      resourceType: 'allergy',
      resourceId: null,
    });
    return result;
  }

  // ─── Conditions ─────────────────────────────────────────────────────────

  async createCondition(
    tenantId: string,
    input: CreateConditionInput,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: HealthConditionEntity) => Promise<void>;
    },
  ): Promise<HealthConditionEntity> {
    await this.assertHealthWriteAccess(accessContext, input.studentId, tenantId);
    if (input.diagnosedDate != null) assertValidCalendarDate(input.diagnosedDate, 'diagnosedDate');
    const entity = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      conditionName: input.conditionName,
      conditionType: input.conditionType,
      diagnosedDate: input.diagnosedDate ?? null,
      status: input.status,
      treatment: input.treatment ?? null,
      medication: input.medication ?? null,
      notes: input.notes ?? null,
    };
    return this.repository.createCondition(entity, options);
  }

  async updateCondition(
    tenantId: string,
    id: string,
    input: UpdateConditionInput,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: HealthConditionEntity) => Promise<void>;
    },
  ): Promise<HealthConditionEntity> {
    const existing = await this.repository.findConditionById(id, tenantId);
    if (!existing) throw new NotFoundError(`Condition with id '${id}' not found`);
    await this.assertHealthWriteAccess(accessContext, existing.studentId, tenantId);
    if (input.diagnosedDate != null) assertValidCalendarDate(input.diagnosedDate, 'diagnosedDate');
    const updated = await this.repository.updateCondition(id, tenantId, input, options);
    if (!updated) throw new NotFoundError(`Condition with id '${id}' not found`);
    return updated;
  }

  /** W1-SEC: conditions had no delete path in the service layer at all. */
  async deleteCondition(
    tenantId: string,
    id: string,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: HealthConditionEntity) => Promise<void>;
    },
  ): Promise<void> {
    const existing = await this.repository.findConditionById(id, tenantId);
    if (!existing) throw new NotFoundError(`Condition with id '${id}' not found`);
    await this.assertHealthWriteAccess(accessContext, existing.studentId, tenantId);
    await this.repository.deleteCondition(id, tenantId, options);
  }

  async listConditions(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
    accessContext: HealthAccessContext,
  ): Promise<PaginatedResult<HealthConditionEntity>> {
    await this.assertHealthAccess(accessContext, studentId, tenantId);
    const result = await this.repository.listConditionsByStudent(tenantId, studentId, pagination);
    await this.auditPhiRead(accessContext, {
      tenantId,
      studentId,
      resourceType: 'condition',
      resourceId: null,
    });
    return result;
  }

  // ─── Vaccinations ───────────────────────────────────────────────────────

  async createVaccination(
    tenantId: string,
    input: CreateVaccinationInput,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: VaccinationEntity) => Promise<void>;
    },
  ): Promise<VaccinationEntity> {
    await this.assertHealthWriteAccess(accessContext, input.studentId, tenantId);
    assertValidCalendarDate(input.dateAdministered, 'dateAdministered');
    if (input.nextDueDate != null) {
      assertValidCalendarDate(input.nextDueDate, 'nextDueDate', { allowFuture: true });
    }
    const entity = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      vaccineName: input.vaccineName,
      doseNumber: input.doseNumber,
      dateAdministered: input.dateAdministered,
      administeredBy: input.administeredBy ?? null,
      batchNumber: input.batchNumber ?? null,
      nextDueDate: input.nextDueDate ?? null,
      notes: input.notes ?? null,
    };
    return this.repository.createVaccination(entity, options);
  }

  async updateVaccination(
    tenantId: string,
    id: string,
    input: UpdateVaccinationInput,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: VaccinationEntity) => Promise<void>;
    },
  ): Promise<VaccinationEntity> {
    const existing = await this.repository.findVaccinationById(id, tenantId);
    if (!existing) throw new NotFoundError(`Vaccination with id '${id}' not found`);
    await this.assertHealthWriteAccess(accessContext, existing.studentId, tenantId);
    if (input.dateAdministered != null) {
      assertValidCalendarDate(input.dateAdministered, 'dateAdministered');
    }
    if (input.nextDueDate != null) {
      assertValidCalendarDate(input.nextDueDate, 'nextDueDate', { allowFuture: true });
    }
    const updated = await this.repository.updateVaccination(id, tenantId, input, options);
    if (!updated) throw new NotFoundError(`Vaccination with id '${id}' not found`);
    return updated;
  }

  /** W1-SEC: vaccinations had no delete path in the service layer at all. */
  async deleteVaccination(
    tenantId: string,
    id: string,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: VaccinationEntity) => Promise<void>;
    },
  ): Promise<void> {
    const existing = await this.repository.findVaccinationById(id, tenantId);
    if (!existing) throw new NotFoundError(`Vaccination with id '${id}' not found`);
    await this.assertHealthWriteAccess(accessContext, existing.studentId, tenantId);
    await this.repository.deleteVaccination(id, tenantId, options);
  }

  async listVaccinations(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
    accessContext: HealthAccessContext,
  ): Promise<PaginatedResult<VaccinationEntity>> {
    await this.assertHealthAccess(accessContext, studentId, tenantId);
    const result = await this.repository.listVaccinationsByStudent(tenantId, studentId, pagination);
    await this.auditPhiRead(accessContext, {
      tenantId,
      studentId,
      resourceType: 'vaccination',
      resourceId: null,
    });
    return result;
  }

  /** Tenant-wide immunisation register (Wave 10 Option B). */
  async listAllVaccinations(
    tenantId: string,
    accessContext: HealthAccessContext,
  ): Promise<VaccinationEntity[]> {
    if (!hasHealthAccess(accessContext, '')) {
      throw new ForbiddenError('Access denied: not authorized to access health records');
    }
    const list = this.repository.listAllVaccinations?.bind(this.repository);
    if (!list) return [];
    return list(tenantId);
  }

  // ─── Insurance ──────────────────────────────────────────────────────────

  async createInsurance(
    tenantId: string,
    input: CreateInsuranceInput,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: InsuranceEntity) => Promise<void>;
    },
  ): Promise<InsuranceEntity> {
    await this.assertHealthWriteAccess(accessContext, input.studentId, tenantId);
    assertValidCalendarDate(input.startDate, 'startDate', { allowFuture: true });
    if (input.endDate != null) {
      assertValidCalendarDate(input.endDate, 'endDate', { allowFuture: true });
    }
    const entity = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      provider: input.provider,
      policyNumber: input.policyNumber,
      coverageType: input.coverageType,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      notes: input.notes ?? null,
    };
    return this.repository.createInsurance(entity, options);
  }

  async updateInsurance(
    tenantId: string,
    id: string,
    input: UpdateInsuranceInput,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: InsuranceEntity) => Promise<void>;
    },
  ): Promise<InsuranceEntity> {
    const existing = await this.repository.findInsuranceById(id, tenantId);
    if (!existing) throw new NotFoundError(`Insurance with id '${id}' not found`);
    await this.assertHealthWriteAccess(accessContext, existing.studentId, tenantId);
    if (input.startDate != null) {
      assertValidCalendarDate(input.startDate, 'startDate', { allowFuture: true });
    }
    if (input.endDate != null) {
      assertValidCalendarDate(input.endDate, 'endDate', { allowFuture: true });
    }
    const updated = await this.repository.updateInsurance(id, tenantId, input, options);
    if (!updated) throw new NotFoundError(`Insurance with id '${id}' not found`);
    return updated;
  }

  /** W1-SEC: insurance had no delete path in the service layer at all. */
  async deleteInsurance(
    tenantId: string,
    id: string,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: InsuranceEntity) => Promise<void>;
    },
  ): Promise<void> {
    const existing = await this.repository.findInsuranceById(id, tenantId);
    if (!existing) throw new NotFoundError(`Insurance with id '${id}' not found`);
    await this.assertHealthWriteAccess(accessContext, existing.studentId, tenantId);
    await this.repository.deleteInsurance(id, tenantId, options);
  }

  async listInsurance(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
    accessContext: HealthAccessContext,
  ): Promise<PaginatedResult<InsuranceEntity>> {
    await this.assertHealthAccess(accessContext, studentId, tenantId);
    const result = await this.repository.listInsuranceByStudent(tenantId, studentId, pagination);
    await this.auditPhiRead(accessContext, {
      tenantId,
      studentId,
      resourceType: 'insurance',
      resourceId: null,
    });
    return result;
  }

  // ─── Special Needs Assessments ──────────────────────────────────────────

  async createAssessment(
    tenantId: string,
    input: CreateSpecialNeedsAssessmentInput,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (
        client: PgQueryable,
        entity: SpecialNeedsAssessmentEntity,
      ) => Promise<void>;
    },
  ): Promise<SpecialNeedsAssessmentEntity> {
    await this.assertHealthWriteAccess(accessContext, input.studentId, tenantId);
    assertValidCalendarDate(input.assessmentDate, 'assessmentDate');
    const entity = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      assessmentDate: input.assessmentDate,
      assessorName: input.assessorName,
      assessorRole: input.assessorRole,
      assessmentType: input.assessmentType,
      findings: input.findings,
      recommendations: input.recommendations ?? null,
    };
    return this.repository.createAssessment(entity, options);
  }

  async listAssessments(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
    accessContext: HealthAccessContext,
  ): Promise<PaginatedResult<SpecialNeedsAssessmentEntity>> {
    await this.assertHealthAccess(accessContext, studentId, tenantId);
    const result = await this.repository.listAssessmentsByStudent(tenantId, studentId, pagination);
    await this.auditPhiRead(accessContext, {
      tenantId,
      studentId,
      resourceType: 'special_needs_assessment',
      resourceId: null,
    });
    return result;
  }

  // ─── Diagnoses ──────────────────────────────────────────────────────────

  async createDiagnosis(
    tenantId: string,
    input: CreateDiagnosisInput,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: DiagnosisEntity) => Promise<void>;
    },
  ): Promise<DiagnosisEntity> {
    await this.assertHealthWriteAccess(accessContext, input.studentId, tenantId);
    assertValidCalendarDate(input.diagnosisDate, 'diagnosisDate');
    const entity = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      assessmentId: input.assessmentId ?? null,
      diagnosisDate: input.diagnosisDate,
      diagnosedBy: input.diagnosedBy,
      condition: input.condition,
      category: input.category,
      severity: input.severity,
      notes: input.notes ?? null,
    };
    return this.repository.createDiagnosis(entity, options);
  }

  async listDiagnoses(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
    accessContext: HealthAccessContext,
  ): Promise<PaginatedResult<DiagnosisEntity>> {
    await this.assertHealthAccess(accessContext, studentId, tenantId);
    const result = await this.repository.listDiagnosesByStudent(tenantId, studentId, pagination);
    await this.auditPhiRead(accessContext, {
      tenantId,
      studentId,
      resourceType: 'diagnosis',
      resourceId: null,
    });
    return result;
  }

  // ─── Referrals ──────────────────────────────────────────────────────────

  async createReferral(
    tenantId: string,
    input: CreateReferralInput,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: ReferralEntity) => Promise<void>;
    },
  ): Promise<ReferralEntity> {
    await this.assertHealthWriteAccess(accessContext, input.studentId, tenantId);
    assertValidCalendarDate(input.referralDate, 'referralDate');
    if (input.appointmentDate != null) {
      assertValidCalendarDate(input.appointmentDate, 'appointmentDate', { allowFuture: true });
    }
    const entity = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      diagnosisId: input.diagnosisId ?? null,
      referralDate: input.referralDate,
      referredBy: input.referredBy,
      referredTo: input.referredTo,
      reason: input.reason,
      status: input.status,
      appointmentDate: input.appointmentDate ?? null,
      outcome: input.outcome ?? null,
    };
    return this.repository.createReferral(entity, options);
  }

  async updateReferral(
    tenantId: string,
    id: string,
    input: UpdateReferralInput,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: ReferralEntity) => Promise<void>;
    },
  ): Promise<ReferralEntity> {
    const existing = await this.repository.findReferralById(id, tenantId);
    if (!existing) throw new NotFoundError(`Referral with id '${id}' not found`);
    await this.assertHealthWriteAccess(accessContext, existing.studentId, tenantId);
    if (input.appointmentDate != null) {
      assertValidCalendarDate(input.appointmentDate, 'appointmentDate', { allowFuture: true });
    }
    const updated = await this.repository.updateReferral(id, tenantId, input, options);
    if (!updated) throw new NotFoundError(`Referral with id '${id}' not found`);
    return updated;
  }

  async listReferrals(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
    accessContext: HealthAccessContext,
  ): Promise<PaginatedResult<ReferralEntity>> {
    await this.assertHealthAccess(accessContext, studentId, tenantId);
    const result = await this.repository.listReferralsByStudent(tenantId, studentId, pagination);
    await this.auditPhiRead(accessContext, {
      tenantId,
      studentId,
      resourceType: 'referral',
      resourceId: null,
    });
    return result;
  }

  // ─── Accommodation Plans ────────────────────────────────────────────────

  async createAccommodationPlan(
    tenantId: string,
    input: CreateAccommodationPlanInput,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: AccommodationPlanEntity) => Promise<void>;
    },
  ): Promise<AccommodationPlanEntity> {
    await this.assertHealthWriteAccess(accessContext, input.studentId, tenantId);
    assertValidCalendarDate(input.startDate, 'startDate', { allowFuture: true });
    if (input.endDate != null) {
      assertValidCalendarDate(input.endDate, 'endDate', { allowFuture: true });
    }
    if (input.reviewDate != null) {
      assertValidCalendarDate(input.reviewDate, 'reviewDate', { allowFuture: true });
    }
    const entity = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      diagnosisId: input.diagnosisId ?? null,
      planName: input.planName,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      accommodations: input.accommodations,
      reviewDate: input.reviewDate ?? null,
      status: input.status,
      notes: input.notes ?? null,
    };
    return this.repository.createAccommodationPlan(entity, options);
  }

  async updateAccommodationPlan(
    tenantId: string,
    id: string,
    input: UpdateAccommodationPlanInput,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: AccommodationPlanEntity) => Promise<void>;
    },
  ): Promise<AccommodationPlanEntity> {
    const existing = await this.repository.findAccommodationPlanById(id, tenantId);
    if (!existing) throw new NotFoundError(`Accommodation plan with id '${id}' not found`);
    await this.assertHealthWriteAccess(accessContext, existing.studentId, tenantId);
    if (input.startDate != null) {
      assertValidCalendarDate(input.startDate, 'startDate', { allowFuture: true });
    }
    if (input.endDate != null) {
      assertValidCalendarDate(input.endDate, 'endDate', { allowFuture: true });
    }
    if (input.reviewDate != null) {
      assertValidCalendarDate(input.reviewDate, 'reviewDate', { allowFuture: true });
    }
    const updated = await this.repository.updateAccommodationPlan(id, tenantId, input, options);
    if (!updated) throw new NotFoundError(`Accommodation plan with id '${id}' not found`);
    return updated;
  }

  async listAccommodationPlans(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
    accessContext: HealthAccessContext,
  ): Promise<PaginatedResult<AccommodationPlanEntity>> {
    await this.assertHealthAccess(accessContext, studentId, tenantId);
    const result = await this.repository.listAccommodationPlansByStudent(
      tenantId,
      studentId,
      pagination,
    );
    await this.auditPhiRead(accessContext, {
      tenantId,
      studentId,
      resourceType: 'accommodation_plan',
      resourceId: null,
    });
    return result;
  }

  // ─── Counselling Sessions ───────────────────────────────────────────────

  async createCounsellingSession(
    tenantId: string,
    input: CreateCounsellingSessionInput,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: CounsellingSessionEntity) => Promise<void>;
    },
  ): Promise<CounsellingSessionEntity> {
    await this.assertHealthWriteAccess(accessContext, input.studentId, tenantId);
    // PRC-M272 / NEW-008: reject attacker-supplied enc:v* markers on write.
    assertNotPhiCiphertextInput(input.caseNotes, 'caseNotes');
    assertNotPhiCiphertextInput(input.reason, 'reason');
    assertNotPhiCiphertextInput(input.outcome, 'outcome');
    assertValidCalendarDate(input.sessionDate, 'sessionDate');
    if (input.followUpDate != null) {
      assertValidCalendarDate(input.followUpDate, 'followUpDate', { allowFuture: true });
    }
    if (input.followUpRequired && !input.followUpDate) {
      throw new BusinessRuleError(
        'Follow-up date is required when follow-up is marked as required',
      );
    }
    const entity = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      counsellorId: input.counsellorId,
      sessionDate: input.sessionDate,
      sessionType: input.sessionType,
      reason: input.reason,
      caseNotes: input.caseNotes,
      outcome: input.outcome ?? null,
      followUpRequired: input.followUpRequired,
      followUpDate: input.followUpDate ?? null,
      status: input.status,
    };
    return this.repository.createCounsellingSession(entity, options);
  }

  async updateCounsellingSession(
    tenantId: string,
    id: string,
    input: UpdateCounsellingSessionInput,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: CounsellingSessionEntity) => Promise<void>;
    },
  ): Promise<CounsellingSessionEntity> {
    const existing = await this.repository.findCounsellingSessionById(id, tenantId);
    if (!existing) throw new NotFoundError(`Counselling session with id '${id}' not found`);
    await this.assertHealthWriteAccess(accessContext, existing.studentId, tenantId);

    // PRC-M272 / NEW-008: never let a client store a crafted enc:v* marker.
    assertNotPhiCiphertextInput(input.caseNotes, 'caseNotes');
    assertNotPhiCiphertextInput(input.reason, 'reason');
    assertNotPhiCiphertextInput(input.outcome, 'outcome');

    if (input.sessionDate != null) assertValidCalendarDate(input.sessionDate, 'sessionDate');
    if (input.followUpDate != null) {
      assertValidCalendarDate(input.followUpDate, 'followUpDate', { allowFuture: true });
    }

    // PRC-M274 / NEW-007: a client that GETs a redacted session (caseNotes =
    // '[REDACTED]') and PUTs it back must not overwrite the real notes with the
    // placeholder. Reject the write rather than silently losing PHI.
    if (input.caseNotes === PHI_FIELD_REDACTED) {
      throw new BusinessRuleError(
        `caseNotes cannot be set to the redaction placeholder '${PHI_FIELD_REDACTED}'; ` +
          'this value indicates a round-tripped redacted record. Omit the field to leave it unchanged.',
      );
    }

    // Validate follow-up consistency. PRC-L562: use an explicit property check so
    // that clearing the date (followUpDate: null) is validated against
    // followUpRequired instead of silently falling back to the existing value.
    const followUpRequired = input.followUpRequired ?? existing.followUpRequired;
    const followUpDate = Object.prototype.hasOwnProperty.call(input, 'followUpDate')
      ? (input.followUpDate ?? null)
      : existing.followUpDate;
    if (followUpRequired && !followUpDate) {
      throw new BusinessRuleError(
        'Follow-up date is required when follow-up is marked as required',
      );
    }
    const updated = await this.repository.updateCounsellingSession(id, tenantId, input, options);
    if (!updated) throw new NotFoundError(`Counselling session with id '${id}' not found`);
    const [aclSession] = redactCounsellingReasons(
      accessContext,
      await this.applyCaseNotesFieldAcl(tenantId, accessContext, [updated]),
    );
    return aclSession!;
  }

  async listCounsellingSessions(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
    accessContext: HealthAccessContext,
  ): Promise<PaginatedResult<CounsellingSessionEntity>> {
    await this.assertHealthAccess(accessContext, studentId, tenantId);
    const result = await this.repository.listCounsellingSessionsByStudent(
      tenantId,
      studentId,
      pagination,
    );
    await this.auditPhiRead(accessContext, {
      tenantId,
      studentId,
      resourceType: 'counselling_session',
      resourceId: null,
    });
    const data = redactCounsellingReasons(
      accessContext,
      await this.applyCaseNotesFieldAcl(tenantId, accessContext, result.data),
    );
    return { ...result, data };
  }

  // ─── Screening Programs ─────────────────────────────────────────────────

  /**
   * PRC-L315: screening programs had no role gating at all. Reuses the
   * existing tenant-wide-list-surface branch of hasHealthAccess (authorized
   * health role + tenant-wide status) — there is no institution scoping
   * since ScreeningProgramEntity has no institutionId field.
   */
  private assertScreeningProgramAccess(accessContext: HealthAccessContext): void {
    if (!hasHealthAccess(accessContext, '')) {
      throw new ForbiddenError('Access denied: not authorized to manage screening programs');
    }
  }

  async createScreeningProgram(
    tenantId: string,
    input: CreateScreeningProgramInput,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: ScreeningProgramEntity) => Promise<void>;
    },
  ): Promise<ScreeningProgramEntity> {
    this.assertScreeningProgramAccess(accessContext);
    const entity = {
      id: uuidv4(),
      tenantId,
      name: input.name,
      description: input.description ?? null,
      gradeLevel: input.gradeLevel,
      academicPeriodId: input.academicPeriodId,
      assessmentTypes: input.assessmentTypes,
      scheduledDate: input.scheduledDate ?? null,
      status: input.status,
    };
    return this.repository.createScreeningProgram(entity, options);
  }

  async updateScreeningProgram(
    tenantId: string,
    id: string,
    input: UpdateScreeningProgramInput,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: ScreeningProgramEntity) => Promise<void>;
    },
  ): Promise<ScreeningProgramEntity> {
    this.assertScreeningProgramAccess(accessContext);
    const existing = await this.repository.findScreeningProgramById(id, tenantId);
    if (!existing) throw new NotFoundError(`Screening program with id '${id}' not found`);
    const updated = await this.repository.updateScreeningProgram(id, tenantId, input, options);
    if (!updated) throw new NotFoundError(`Screening program with id '${id}' not found`);
    return updated;
  }

  /** W1-SEC: screening programs had no delete path anywhere in this stack. */
  async deleteScreeningProgram(
    tenantId: string,
    id: string,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: ScreeningProgramEntity) => Promise<void>;
    },
  ): Promise<void> {
    this.assertScreeningProgramAccess(accessContext);
    const existing = await this.repository.findScreeningProgramById(id, tenantId);
    if (!existing) throw new NotFoundError(`Screening program with id '${id}' not found`);
    await this.repository.deleteScreeningProgram(id, tenantId, options);
  }

  async getScreeningProgram(
    tenantId: string,
    id: string,
    accessContext: HealthAccessContext,
  ): Promise<ScreeningProgramEntity> {
    this.assertScreeningProgramAccess(accessContext);
    const entity = await this.repository.findScreeningProgramById(id, tenantId);
    if (!entity) throw new NotFoundError(`Screening program with id '${id}' not found`);
    return entity;
  }

  async listScreeningPrograms(
    tenantId: string,
    pagination: PaginationOptions,
    accessContext: HealthAccessContext,
  ): Promise<PaginatedResult<ScreeningProgramEntity>> {
    this.assertScreeningProgramAccess(accessContext);
    return this.repository.listScreeningPrograms(tenantId, pagination);
  }

  async listScreeningProgramsByGrade(
    tenantId: string,
    gradeLevel: string,
    pagination: PaginationOptions,
    accessContext: HealthAccessContext,
  ): Promise<PaginatedResult<ScreeningProgramEntity>> {
    this.assertScreeningProgramAccess(accessContext);
    return this.repository.listScreeningProgramsByGrade(tenantId, gradeLevel, pagination);
  }
  /**
   * PRC-M275 (12b): the original one-shot `{ page: 1, pageSize: 100 }` +
   * `Promise.all` call silently capped every DSAR export section at 100 rows
   * — a student with 150 measurements would export only the first 100 with
   * no indication any were missing. Loops a `list*` call until a page comes
   * back shorter than `pageSize`, accumulating every row.
   */
  private async fetchAllPages<T>(
    lister: (page: PaginationOptions) => Promise<PaginatedResult<T>>,
    pageSize = 100,
  ): Promise<T[]> {
    const out: T[] = [];
    for (let pageNum = 1; ; pageNum += 1) {
      const result = await lister({ page: pageNum, pageSize });
      out.push(...result.data);
      if (result.data.length < pageSize) break;
    }
    return out;
  }

  /**
   * G-734 — DSAR export of PHI held for a student (measurements, allergies,
   * conditions, vaccinations, insurance, special needs, counselling).
   * Access control mirrors other student PHI reads.
   */
  async exportStudentDsarPackage(
    tenantId: string,
    studentId: string,
    accessContext: HealthAccessContext,
  ): Promise<{
    subjectId: string;
    tenantId: string;
    exportedAt: string;
    sections: Record<string, unknown>;
  }> {
    await this.assertHealthAccess(accessContext, studentId, tenantId);
    // PRC-M275 (12b): fetchAllPages removes the 100-row cap on every section.
    const [
      measurements,
      allergies,
      conditions,
      vaccinations,
      insurance,
      assessments,
      diagnoses,
      referrals,
      accommodationPlans,
      counsellingSessions,
    ] = await Promise.all([
      this.fetchAllPages((p) => this.repository.listMeasurementsByStudent(tenantId, studentId, p)),
      this.fetchAllPages((p) => this.repository.listAllergiesByStudent(tenantId, studentId, p)),
      this.fetchAllPages((p) => this.repository.listConditionsByStudent(tenantId, studentId, p)),
      this.fetchAllPages((p) => this.repository.listVaccinationsByStudent(tenantId, studentId, p)),
      this.fetchAllPages((p) => this.repository.listInsuranceByStudent(tenantId, studentId, p)),
      this.fetchAllPages((p) => this.repository.listAssessmentsByStudent(tenantId, studentId, p)),
      this.fetchAllPages((p) => this.repository.listDiagnosesByStudent(tenantId, studentId, p)),
      this.fetchAllPages((p) => this.repository.listReferralsByStudent(tenantId, studentId, p)),
      this.fetchAllPages((p) =>
        this.repository.listAccommodationPlansByStudent(tenantId, studentId, p),
      ),
      this.fetchAllPages((p) =>
        this.repository.listCounsellingSessionsByStudent(tenantId, studentId, p),
      ),
    ]);

    // PRC-M275 (12a): nurseIncidents + phiAccessHistory sections were absent
    // entirely. listNurseIncidentsByStudent is a per-student call already on
    // HealthRepository (optional, for older impls). phiAccessHistory calls the
    // repository directly (not through the role-gated listPhiAccessLogs
    // wrapper above) since DSAR access is already checked via
    // assertHealthAccess at the top of this method — the stricter
    // PHI_ACCESS_LOG_ROLES clearance that wrapper enforces does not apply here.
    const nurseIncidents =
      (await this.repository.listNurseIncidentsByStudent?.(tenantId, studentId)) ?? [];
    const repo = this.repository as PhiAccessCapableRepository;
    const phiAccessHistory = (await repo.listPhiAccessLogs?.(tenantId, { studentId })) ?? [];

    await this.auditPhiRead(accessContext, {
      tenantId,
      studentId,
      resourceType: 'dsar_export',
      resourceId: null,
    });

    const counsellingWithAcl = redactCounsellingReasons(
      accessContext,
      await this.applyCaseNotesFieldAcl(tenantId, accessContext, counsellingSessions),
    );

    return {
      subjectId: studentId,
      tenantId,
      exportedAt: new Date().toISOString(),
      sections: {
        measurements,
        allergies,
        conditions,
        vaccinations,
        insurance,
        specialNeedsAssessments: assessments,
        diagnoses,
        referrals,
        accommodationPlans,
        counsellingSessions: counsellingWithAcl,
        nurseIncidents,
        phiAccessHistory,
      },
    };
  }

  async listPhiAccessLogs(
    tenantId: string,
    access: HealthAccessContext,
    options: { studentId?: string; limit?: number } = {},
  ) {
    const privileged = hasHealthRole(access.roles, PHI_ACCESS_LOG_ROLES);
    if (!privileged) {
      throw new ForbiddenError('Access denied: PHI access log requires a health admin role');
    }
    const repo = this.repository as PhiAccessCapableRepository;
    if (typeof repo.listPhiAccessLogs !== 'function') return [];
    return repo.listPhiAccessLogs(tenantId, options);
  }

  // ─── Health PHI break-glass (P0-09) ──────────────────────────────────────

  async requestBreakGlass(
    tenantId: string,
    input: CreateHealthBreakGlassRequestInput,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: HealthBreakGlassGrant) => Promise<void>;
    },
  ): Promise<HealthBreakGlassGrant> {
    await this.assertHealthWriteAccess(accessContext, input.studentId, tenantId);
    if (!accessContext.userId) {
      throw new ForbiddenError('Access denied: authenticated user required for break-glass');
    }
    if (!isHealthPhiFieldPath(input.fieldPath)) {
      throw new BusinessRuleError(`Unsupported PHI field path: ${input.fieldPath}`);
    }
    const durationMinutes = input.durationMinutes ?? HEALTH_BREAK_GLASS_DEFAULT_MINUTES;
    if (durationMinutes < 1 || durationMinutes > HEALTH_BREAK_GLASS_MAX_MINUTES) {
      throw new BusinessRuleError(
        `durationMinutes must be between 1 and ${HEALTH_BREAK_GLASS_MAX_MINUTES}`,
      );
    }
    const repo = this.repository as PhiAccessCapableRepository;
    if (typeof repo.createBreakGlassGrant !== 'function') {
      throw new BusinessRuleError('Break-glass grants are not available on this repository');
    }
    return repo.createBreakGlassGrant(
      {
        tenantId,
        requesterUserId: accessContext.userId,
        studentId: input.studentId,
        fieldPath: input.fieldPath,
        justification: input.justification,
        durationMinutes,
      },
      options,
    );
  }

  async approveBreakGlass(
    tenantId: string,
    id: string,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: HealthBreakGlassGrant) => Promise<void>;
    },
  ): Promise<HealthBreakGlassGrant> {
    if (!canApproveHealthBreakGlass(accessContext.roles)) {
      throw new ForbiddenError('Access denied: break-glass approval requires health_admin');
    }
    if (!accessContext.userId) {
      throw new ForbiddenError('Access denied: authenticated user required for break-glass');
    }
    const repo = this.repository as PhiAccessCapableRepository;
    if (typeof repo.approveBreakGlassGrant !== 'function') {
      throw new BusinessRuleError('Break-glass grants are not available on this repository');
    }
    try {
      const updated = await repo.approveBreakGlassGrant(
        id,
        tenantId,
        accessContext.userId,
        options,
      );
      if (!updated) throw new NotFoundError(`Break-glass grant with id '${id}' not found`);
      return updated;
    } catch (error) {
      if (error instanceof Error && error.message === 'DUAL_CONTROL_VIOLATION') {
        throw new BusinessRuleError(
          'Dual-control violation: requester cannot approve their own break-glass grant',
        );
      }
      // PRC-L113 sub-issue 2: an already-resolved grant must not be silently
      // re-approved with a 200.
      if (error instanceof BreakGlassNotPendingError) {
        throw new BusinessRuleError(
          `Break-glass grant '${id}' is already '${error.status}' and cannot be re-approved/re-denied`,
        );
      }
      throw error;
    }
  }

  async denyBreakGlass(
    tenantId: string,
    id: string,
    accessContext: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: HealthBreakGlassGrant) => Promise<void>;
    },
  ): Promise<HealthBreakGlassGrant> {
    if (!canApproveHealthBreakGlass(accessContext.roles)) {
      throw new ForbiddenError('Access denied: break-glass denial requires health_admin');
    }
    if (!accessContext.userId) {
      throw new ForbiddenError('Access denied: authenticated user required for break-glass');
    }
    const repo = this.repository as PhiAccessCapableRepository;
    if (typeof repo.denyBreakGlassGrant !== 'function') {
      throw new BusinessRuleError('Break-glass grants are not available on this repository');
    }
    try {
      const updated = await repo.denyBreakGlassGrant(id, tenantId, accessContext.userId, options);
      if (!updated) throw new NotFoundError(`Break-glass grant with id '${id}' not found`);
      return updated;
    } catch (error) {
      if (error instanceof Error && error.message === 'DUAL_CONTROL_VIOLATION') {
        throw new BusinessRuleError(
          'Dual-control violation: requester cannot deny their own break-glass grant',
        );
      }
      // PRC-L113 sub-issue 2: an already-resolved grant must not be silently
      // re-denied with a 200.
      if (error instanceof BreakGlassNotPendingError) {
        throw new BusinessRuleError(
          `Break-glass grant '${id}' is already '${error.status}' and cannot be re-approved/re-denied`,
        );
      }
      throw error;
    }
  }

  async listBreakGlassGrants(
    tenantId: string,
    accessContext: HealthAccessContext,
    options: { studentId?: string; limit?: number } = {},
  ): Promise<HealthBreakGlassGrant[]> {
    const privileged =
      canApproveHealthBreakGlass(accessContext.roles) ||
      accessContext.roles.some((r) => ['health_officer', 'counsellor', 'school_nurse'].includes(r));
    if (!privileged) {
      throw new ForbiddenError('Access denied: not authorized to list health break-glass grants');
    }
    const repo = this.repository as PhiAccessCapableRepository;
    if (typeof repo.listBreakGlassGrants !== 'function') return [];
    return repo.listBreakGlassGrants(tenantId, options);
  }

  async createNurseIncident(
    tenantId: string,
    input: {
      studentId: string;
      institutionId?: string;
      incidentAt: string;
      category: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      notes?: string;
      reportedBy: string;
    },
    access: HealthAccessContext,
    options?: {
      appendAuditInTxn?: (client: PgQueryable, entity: NurseIncidentEntity) => Promise<void>;
    },
  ) {
    await this.assertHealthAccess(access, input.studentId, tenantId);
    const create = this.repository.createNurseIncident?.bind(this.repository);
    if (!create) {
      throw new BusinessRuleError('Nurse incidents are not available on this repository');
    }

    // PRC-M272 / NEW-008: reject crafted enc:v* markers in free-text notes.
    assertNotPhiCiphertextInput(input.notes, 'notes');

    // PRC-M520 / NEW-013: incidentAt must be a valid, bounded calendar datetime.
    // Reject unparseable values and timestamps implausibly far in the future
    // (a small clock-skew allowance) or absurdly far in the past.
    const incidentAt = new Date(input.incidentAt);
    if (Number.isNaN(incidentAt.getTime())) {
      throw new BusinessRuleError('incidentAt must be a valid ISO datetime');
    }
    const now = Date.now();
    const skewMs = 24 * 60 * 60 * 1000; // allow 1 day of clock skew
    if (incidentAt.getTime() > now + skewMs) {
      throw new BusinessRuleError('incidentAt cannot be in the future');
    }
    if (incidentAt.getTime() < Date.UTC(1900, 0, 1)) {
      throw new BusinessRuleError('incidentAt is out of the supported range');
    }

    // PRC-M520 / NEW-013: institutionId must be within the caller's scope. A
    // tenant-wide health admin may file for any institution; a school-bound
    // actor may only use one of their authoritative institutions.
    const effective = await this.resolveAuthoritativeInstitutions(tenantId, access);
    const institutionId: string | null = input.institutionId ?? null;
    if (institutionId && !isTenantWideHealthActor(effective)) {
      const allowed = effectiveInstitutionIds(effective);
      if (!allowed.includes(institutionId)) {
        throw new ForbiddenError(
          'Access denied: institutionId is outside the caller’s institution scope',
        );
      }
    }

    // PRC-M520 / NEW-013: reportedBy is derived from the authenticated actor,
    // never from the request body — a user cannot attribute an incident to
    // another staff member.
    const reportedBy = access.userId;
    if (!reportedBy) {
      throw new ForbiddenError(
        'Access denied: authenticated actor is required to report incidents',
      );
    }

    return create(
      {
        id: uuidv4(),
        tenantId,
        studentId: input.studentId,
        institutionId,
        incidentAt,
        category: input.category,
        severity: input.severity,
        notes: input.notes ?? '',
        reportedBy,
      },
      options,
    );
  }

  async listNurseIncidents(tenantId: string, access: HealthAccessContext) {
    if (!hasHealthAccess(access, '')) {
      throw new ForbiddenError('Access denied: not authorized to access health records');
    }
    const list = this.repository.listNurseIncidents?.bind(this.repository);
    return list ? list(tenantId) : [];
  }
}
