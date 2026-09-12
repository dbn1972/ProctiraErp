/**
 * Field-level ACL for sensitive health PHI surfaces (P0-09).
 *
 * Coarse `hasHealthAccess` still gates the resource; this module controls
 * whether a sensitive *field* is returned as plaintext or redacted.
 * Unredaction requires an active health-local break-glass grant.
 */
import type { CounsellingSessionEntity } from './health-repository.js';

/** Sensitive field path covered by this slice. */
export const PHI_FIELD_COUNSELLING_CASE_NOTES = 'counselling.case_notes';

export type HealthPhiFieldPath = typeof PHI_FIELD_COUNSELLING_CASE_NOTES;

export const HEALTH_PHI_FIELD_PATHS: readonly HealthPhiFieldPath[] = [
  PHI_FIELD_COUNSELLING_CASE_NOTES,
];

/** Placeholder returned when the caller lacks an active field grant. */
export const PHI_FIELD_REDACTED = '[REDACTED]';

/** 4-hour ceiling (aligned with platform break-glass policy). */
export const HEALTH_BREAK_GLASS_MAX_MINUTES = 240;

export const HEALTH_BREAK_GLASS_DEFAULT_MINUTES = 60;

/** Roles allowed to approve a health PHI break-glass request. */
export const HEALTH_BREAK_GLASS_APPROVER_ROLES = ['health_admin', 'system_admin'] as const;

export type HealthBreakGlassStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'revoked';

export interface HealthBreakGlassGrant {
  id: string;
  tenantId: string;
  requesterUserId: string;
  approverUserId: string | null;
  studentId: string;
  fieldPath: HealthPhiFieldPath;
  justification: string;
  status: HealthBreakGlassStatus;
  durationMinutes: number;
  approvedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateHealthBreakGlassInput {
  tenantId: string;
  requesterUserId: string;
  studentId: string;
  fieldPath: HealthPhiFieldPath;
  justification: string;
  durationMinutes: number;
}

export function isHealthPhiFieldPath(value: string): value is HealthPhiFieldPath {
  return (HEALTH_PHI_FIELD_PATHS as readonly string[]).includes(value);
}

export function canApproveHealthBreakGlass(roles: string[]): boolean {
  return roles.some((role) =>
    (HEALTH_BREAK_GLASS_APPROVER_ROLES as readonly string[]).includes(role),
  );
}

export function isBreakGlassGrantActive(
  grant: HealthBreakGlassGrant | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!grant) return false;
  if (grant.status !== 'approved') return false;
  if (!grant.expiresAt) return false;
  return new Date(grant.expiresAt).getTime() > now.getTime();
}

export interface FieldAclResult<T> {
  entity: T;
  redacted: boolean;
  breakGlassId: string | null;
}

/**
 * Apply field ACL to counselling case notes.
 * Without an active grant for the actor, `caseNotes` is replaced with `[REDACTED]`.
 */
export function applyCounsellingCaseNotesAcl(
  session: CounsellingSessionEntity,
  grant: HealthBreakGlassGrant | null,
  now: Date = new Date(),
): FieldAclResult<CounsellingSessionEntity> {
  if (isBreakGlassGrantActive(grant, now)) {
    return {
      entity: session,
      redacted: false,
      breakGlassId: grant!.id,
    };
  }
  return {
    entity: { ...session, caseNotes: PHI_FIELD_REDACTED },
    redacted: true,
    breakGlassId: null,
  };
}
