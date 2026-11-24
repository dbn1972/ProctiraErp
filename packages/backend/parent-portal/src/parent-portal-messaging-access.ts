/**
 * PRC-M314 / NEW-g4_apps_auth-003: the message `senderRole` must be DERIVED from the
 * caller's verified JWT roles, never taken from the request body. A guardian/student
 * who holds (or guesses) a thread id could otherwise inject a message labelled
 * 'staff'/'system' — impersonating the school (fake fee/safeguarding instructions) —
 * and, because the service only runs the guardian-link check when senderRole==='parent',
 * also bypass that check.
 *
 * The route therefore computes senderRole from roles: a caller holding a messaging-staff
 * role posts as 'staff'; everyone else posts as 'parent' (and is link-checked in the
 * service). The 'system' role is reserved for internal/automated callers and is never
 * selectable by an HTTP client.
 */
import { normalizeParentPortalRoles } from './parent-portal-fees-access.js';

const ADMIN_ROLES = [
  'admin',
  'super-admin',
  'super_admin',
  'system_admin',
  'system-admin',
  'principal',
  'school_admin',
  'school-admin',
] as const;

/**
 * Roles permitted to post into a parent-portal thread *as the school* ('staff').
 * Mirrors the teacher/staff/front-office vocabulary that legitimately corresponds
 * with guardians, plus admin roles.
 */
const MESSAGING_STAFF_ROLES = new Set<string>([
  'teacher',
  'staff',
  'class_teacher',
  'homeroom_teacher',
  'registrar',
  'admissions_officer',
  'student_affairs',
  'counselor',
  'counsellor',
  'nurse',
  'front_office',
  'receptionist',
  ...ADMIN_ROLES,
]);

/** True when the caller holds a role permitted to reply in a thread as 'staff'. */
export function isMessagingStaff(roles: unknown): boolean {
  return normalizeParentPortalRoles(roles).some((role) => MESSAGING_STAFF_ROLES.has(role));
}

/** Derive the trusted sender role for a thread message from verified JWT roles. */
export function deriveSenderRole(roles: unknown): 'parent' | 'staff' {
  return isMessagingStaff(roles) ? 'staff' : 'parent';
}
