/**
 * PRC-M160 / PRC-L274: ownership-scoped assessment access (topic 3 Option A,
 * owner decision 2026-10-27).
 *
 * Admin-tier roles, academic coordinators, exam officers and registrars act
 * across the institution. Every other assessment role (teacher, instructor,
 * faculty) is a teacher-only caller: it may only write results, items,
 * outcomes and comments for subjects it teaches, and only read or generate a
 * student's comments, grades and report cards when it teaches that student.
 *
 * The answers come from an injected {@link AssessmentTeachingScope} (the
 * gateway wires a Postgres directory over staff / section_meetings /
 * section_enrollments). Without one, production-like environments fail closed
 * (503) and dev/test keep role-only behaviour.
 */
import { AppError, isProductionLike } from '@proctira/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { hasAssessmentAccess } from './assessment-access.js';

export interface AssessmentTeachingScope {
  teachesSubject(
    tenantId: string,
    principalIds: readonly string[],
    subjectId: string,
  ): Promise<boolean>;
  teachesStudent(
    tenantId: string,
    principalIds: readonly string[],
    studentId: string,
  ): Promise<boolean>;
}

/**
 * PRC-L274: resolves the students a guardian / parent (linked children) or a
 * student (their own record) may read.
 */
export interface AssessmentPortalBinding {
  listReadableStudentIds(tenantId: string, actorUserId: string): Promise<string[]>;
}

const PORTAL_ROLES: ReadonlySet<string> = new Set(['guardian', 'parent', 'student']);

/**
 * PRC-L274: a portal principal with no assessment staff role. Such callers may
 * reach routes marked `config.assessmentPortalRead` and are bound to their
 * students there; every other assessment route stays staff-only.
 */
export function isAssessmentPortalReader(roles: unknown): boolean {
  const ids = roleIdsOnly(roles);
  return (
    ids.some((role) => PORTAL_ROLES.has(role)) && !hasAssessmentAccess(roles, 'assessment.read')
  );
}

/** Role ids whose assessment access is institution-wide (not bound to teaching). */
const INSTITUTION_WIDE_ROLE_IDS: ReadonlySet<string> = new Set([
  'admin',
  'super-admin',
  'super_admin',
  'system_admin',
  'system-admin',
  'administrator',
  'principal',
  'school_admin',
  'school-admin',
  'academic_coordinator',
  'academic-coordinator',
  'examinations_officer',
  'registrar',
]);

/**
 * Role ids only (string roles or `roleId`). A tenant-editable `roleName` must
 * not lift a teacher out of the teaching requirement.
 */
function roleIdsOnly(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((r) => {
      if (typeof r === 'string') return r.toLowerCase();
      if (r && typeof r === 'object') {
        const roleId = (r as { roleId?: unknown }).roleId;
        return typeof roleId === 'string' ? roleId.toLowerCase() : '';
      }
      return '';
    })
    .filter(Boolean);
}

export function hasInstitutionWideAssessmentRole(roles: unknown): boolean {
  return roleIdsOnly(roles).some((role) => INSTITUTION_WIDE_ROLE_IDS.has(role));
}

export interface OwnershipTarget {
  subjectIds?: readonly string[];
  studentIds?: readonly string[];
}

interface RequestUser {
  sub?: string;
  id?: string;
  userId?: string;
  roles?: unknown;
}

function principalIdsOf(user: RequestUser | undefined): string[] {
  return [user?.sub, user?.id, user?.userId].filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
}

/**
 * Throws 403 when a teacher-only caller does not teach every subject and
 * student in `target`; 503 when no scope is wired in a production-like env.
 */
export async function assertAssessmentOwnership(
  user: RequestUser | undefined,
  tenantId: string,
  scope: AssessmentTeachingScope | null | undefined,
  target: OwnershipTarget,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): Promise<void> {
  if (hasInstitutionWideAssessmentRole(user?.roles)) return;
  const subjectIds = [...new Set(target.subjectIds ?? [])];
  const studentIds = [...new Set(target.studentIds ?? [])];
  if (subjectIds.length === 0 && studentIds.length === 0) return;
  if (!scope) {
    if (isProductionLike(nodeEnv)) {
      throw new AppError(
        'Assessment ownership lookup is not configured; this action is unavailable',
        'SERVICE_UNAVAILABLE',
        503,
      );
    }
    return;
  }
  const principals = principalIdsOf(user);
  for (const subjectId of subjectIds) {
    if (!principals.length || !(await scope.teachesSubject(tenantId, principals, subjectId))) {
      throw new AppError('Forbidden: you do not teach this subject', 'FORBIDDEN', 403);
    }
  }
  for (const studentId of studentIds) {
    if (!principals.length || !(await scope.teachesStudent(tenantId, principals, studentId))) {
      throw new AppError('Forbidden: you do not teach this student', 'FORBIDDEN', 403);
    }
  }
}

/** Route helper: sends the 403/503 and returns false when ownership fails. */
export async function requireAssessmentOwnership(
  request: FastifyRequest,
  reply: FastifyReply,
  tenantId: string,
  scope: AssessmentTeachingScope | null | undefined,
  target: OwnershipTarget,
): Promise<boolean> {
  const user = (request as FastifyRequest & { user?: RequestUser }).user;
  try {
    await assertAssessmentOwnership(user, tenantId, scope, target);
    return true;
  } catch (error) {
    if (error instanceof AppError) {
      void reply.status(error.statusCode).send(error.toJSON());
      return false;
    }
    throw error;
  }
}
