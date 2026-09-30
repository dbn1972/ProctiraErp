/**
 * PRC-C010/C011: read authorization + portal ownership for student records and the students-360
 * PII surfaces (photos, ID cards, documents, discipline, consents, siblings, attendance heatmap).
 *
 * Previously, guardian/parent/student roles were in the student READ_ROLES set with no own-child
 * scoping, so any of them could list/search/read ALL students; and the students-360 routes had no
 * role or ownership check at all. This module classifies staff vs portal readers and binds portal
 * readers to the students they are allowed to see.
 */
import { AppError } from '@proctira/common';

import { normalizeStudentRoles } from './student-access.js';

/**
 * Resolves the student ids a portal caller (guardian/parent/student) may read:
 * guardian/parent → linked children; student → their own id.
 */
export interface StudentPortalBinding {
  listReadableStudentIds(tenantId: string, actorUserId: string): Promise<string[]>;
}

const ADMIN_ROLES = new Set<string>([
  'admin',
  'super-admin',
  'super_admin',
  'system_admin',
  'system-admin',
  'principal',
  'school_admin',
  'school-admin',
]);

const REGISTRAR_ROLES = new Set<string>([
  'registrar',
  'admissions_officer',
  'student_affairs',
  'data_clerk',
]);

/** General staff who may read the student roster/profile (not necessarily sensitive sub-records). */
const STUDENT_READ_STAFF_ROLES = new Set<string>([
  ...ADMIN_ROLES,
  ...REGISTRAR_ROLES,
  'teacher',
  'staff',
  'nurse',
]);

/** Roles allowed to read/write sensitive sub-records (documents, medical). */
const MEDICAL_STAFF_ROLES = new Set<string>([...ADMIN_ROLES, ...REGISTRAR_ROLES, 'nurse']);

/** Roles allowed to manage/read discipline (staff view — includes visibleToParent=false rows). */
const DISCIPLINE_STAFF_ROLES = new Set<string>([
  ...ADMIN_ROLES,
  ...REGISTRAR_ROLES,
  'teacher',
]);

const PORTAL_ROLES = new Set<string>(['guardian', 'parent', 'student']);

export function isStudentReadStaff(roles: unknown): boolean {
  return normalizeStudentRoles(roles).some((r) => STUDENT_READ_STAFF_ROLES.has(r));
}

export function isRegistrarOrAdmin(roles: unknown): boolean {
  return normalizeStudentRoles(roles).some((r) => ADMIN_ROLES.has(r) || REGISTRAR_ROLES.has(r));
}

export function isMedicalStaff(roles: unknown): boolean {
  return normalizeStudentRoles(roles).some((r) => MEDICAL_STAFF_ROLES.has(r));
}

export function isDisciplineStaff(roles: unknown): boolean {
  return normalizeStudentRoles(roles).some((r) => DISCIPLINE_STAFF_ROLES.has(r));
}

export function isPortalReader(roles: unknown): boolean {
  const names = normalizeStudentRoles(roles);
  return names.some((r) => PORTAL_ROLES.has(r)) && !isStudentReadStaff(roles);
}

/** Non-registrar roles must not see raw national IDs / identity documents. */
export function mayViewNationalId(roles: unknown): boolean {
  return isRegistrarOrAdmin(roles);
}

export type StudentReadScope =
  | { kind: 'staff' }
  | { kind: 'self'; studentIds: Set<string> }
  | { kind: 'denied' };

/**
 * Resolve a read request's scope. Staff (roster readers) get 'staff'; portal readers get 'self'
 * bound to their readable student ids; anyone else is denied. `reply` is used only to send the
 * 403 for the denied case, keeping call sites terse.
 */
export async function resolveStudentReadScope(
  roles: unknown,
  actorUserId: string | null,
  tenantId: string,
  binding: StudentPortalBinding | undefined,
): Promise<StudentReadScope> {
  if (isStudentReadStaff(roles)) return { kind: 'staff' };
  if (isPortalReader(roles)) {
    if (!binding || !actorUserId) return { kind: 'denied' };
    const ids = await binding.listReadableStudentIds(tenantId, actorUserId);
    return { kind: 'self', studentIds: new Set(ids) };
  }
  return { kind: 'denied' };
}

export function forbidden(message = 'Forbidden'): AppError {
  return new AppError(message, 'FORBIDDEN', 403);
}

export function notFound(message = 'Not found'): AppError {
  return new AppError(message, 'NOT_FOUND', 404);
}
