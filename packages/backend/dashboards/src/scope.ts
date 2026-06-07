/**
 * Dashboard scope derivation.
 *
 * The dashboard endpoints enforce RBAC + Area_Hierarchy scoping at the
 * query layer (Requirement 40 AC 9). To do that, we first project the
 * authenticated user's JWT claims into a typed scope object that tells
 * us which dashboards they can see and which area / institution / board
 * they are bound to. The handlers then use this scope object to:
 *
 *   1. Reject requests where the dashboard variant is outside the user's
 *      role coverage (e.g., a Teacher hitting the Board Admin endpoint).
 *   2. Filter the underlying aggregate query to only the entities inside
 *      the user's `area_hierarchy` (and institution where applicable).
 *
 * The role IDs are aligned with the design document
 * (`design.md` §G + §Q): roles like `system_admin`, `state_director`,
 * `board_admin`, `principal`, `teacher`, `parent`, `student`.
 */

import type { JwtPayload, RoleAssignment } from '@proctira/auth';

/** The five logical scope levels the dashboards understand. */
export type DashboardScopeLevel =
  | 'country'
  | 'state'
  | 'board'
  | 'school'
  | 'teacher'
  | 'parent_student';

/**
 * Projected scope for a single authenticated request.
 *
 * `areaIds` is the *complete* set of areas the user has been granted —
 * a `state_director` for "MH" will have `areaIds = ['MH']`; the policy
 * filter then matches every aggregate whose own area is `MH` or a
 * descendant via the `AreaHierarchyResolver`.
 */
export interface DashboardScope {
  level: DashboardScopeLevel;
  /** Area_Hierarchy IDs the user is authorised within. Empty for country scope. */
  areaIds: string[];
  /** Institution IDs the user is authorised within. */
  institutionIds: string[];
  /** Board IDs the user administers (board admin only). */
  boardIds: string[];
  /** The user's primary subject (UUID); also used for teacher / parent flows. */
  userId: string;
  /** The user's tenant. */
  tenantId: string;
  /** Raw role assignments — used by the RBAC evaluator. */
  roles: RoleAssignment[];
}

/**
 * Role IDs that grant the country dashboard.
 * Country admins have no Area_Hierarchy restriction.
 */
const COUNTRY_ROLE_IDS = new Set([
  'system_admin',
  'super-admin',
  'ministry_admin',
]);

/** Role IDs that grant a state dashboard, scoped to `roleAssignment.areaId`. */
const STATE_ROLE_IDS = new Set([
  'state_director',
  'state_admin',
]);

/** Role IDs that grant a board admin dashboard, scoped to a board. */
const BOARD_ADMIN_ROLE_IDS = new Set([
  'board_admin',
  'board_regional_officer',
]);

/** Role IDs that grant a school dashboard, scoped to an institution. */
const SCHOOL_ROLE_IDS = new Set([
  'school_admin',
  'principal',
]);

/** Role IDs that grant the teacher dashboard. */
const TEACHER_ROLE_IDS = new Set(['teacher']);

/** Role IDs that grant the parent / student dashboard. */
const PARENT_STUDENT_ROLE_IDS = new Set([
  'parent',
  'student',
  'guardian',
]);

/**
 * Derive the typed dashboard scope from the JWT claims.
 *
 * The most-privileged role wins for the *level* selection, but the
 * `areaIds`, `institutionIds`, and `boardIds` collect across **every**
 * matching role assignment so a state_director who is also a principal
 * still has access to their school dashboard data.
 */
export function deriveDashboardScope(jwt: JwtPayload): DashboardScope {
  const roles = jwt.roles ?? [];

  const hasCountry = roles.some((r) => COUNTRY_ROLE_IDS.has(r.roleId));
  const stateRoles = roles.filter((r) => STATE_ROLE_IDS.has(r.roleId));
  const boardRoles = roles.filter((r) => BOARD_ADMIN_ROLE_IDS.has(r.roleId));
  const schoolRoles = roles.filter((r) => SCHOOL_ROLE_IDS.has(r.roleId));
  const teacherRoles = roles.filter((r) => TEACHER_ROLE_IDS.has(r.roleId));
  const parentRoles = roles.filter((r) => PARENT_STUDENT_ROLE_IDS.has(r.roleId));

  // Most-privileged level (country > state > board > school > teacher > parent_student).
  let level: DashboardScopeLevel;
  if (hasCountry) {
    level = 'country';
  } else if (stateRoles.length > 0) {
    level = 'state';
  } else if (boardRoles.length > 0) {
    level = 'board';
  } else if (schoolRoles.length > 0) {
    level = 'school';
  } else if (teacherRoles.length > 0) {
    level = 'teacher';
  } else if (parentRoles.length > 0) {
    level = 'parent_student';
  } else {
    // Unknown role — deny all dashboards by default.
    level = 'parent_student';
  }

  // Collect area / institution / board IDs across every relevant role.
  const areaIds = new Set<string>();
  const institutionIds = new Set<string>(jwt.institutions ?? []);
  const boardIds = new Set<string>();

  for (const role of stateRoles) areaIds.add(role.areaId);
  for (const role of schoolRoles) {
    if (role.institutionId) institutionIds.add(role.institutionId);
    areaIds.add(role.areaId);
  }
  for (const role of teacherRoles) {
    if (role.institutionId) institutionIds.add(role.institutionId);
    areaIds.add(role.areaId);
  }
  for (const role of parentRoles) {
    if (role.institutionId) institutionIds.add(role.institutionId);
  }
  for (const role of boardRoles) {
    // Board IDs ride along on the role assignment — by convention the
    // `areaId` of a `board_admin` role assignment is the board ID.
    boardIds.add(role.areaId);
  }

  // Country admins inherit all areas via the resolver, so we leave
  // areaIds empty (the policy filter treats an empty set, when level is
  // country, as "any area").
  return {
    level,
    areaIds: Array.from(areaIds),
    institutionIds: Array.from(institutionIds),
    boardIds: Array.from(boardIds),
    userId: jwt.sub,
    tenantId: jwt.tenantId,
    roles,
  };
}

/** Dashboard variants exposed by the gateway. */
export type DashboardVariant =
  | 'country'
  | 'state'
  | 'board-admin'
  | 'school'
  | 'teacher'
  | 'me';

/**
 * Whether a derived scope is allowed to *load* a given dashboard variant.
 * This is the first gate; per-resource Area_Hierarchy filtering happens
 * after this check.
 */
export function canAccessVariant(
  scope: DashboardScope,
  variant: DashboardVariant,
): boolean {
  switch (variant) {
    case 'country':
      return scope.level === 'country';
    case 'state':
      // Country admins can read any state; state admins can read theirs.
      return scope.level === 'country' || scope.level === 'state';
    case 'board-admin':
      // Country admins and explicit board admins.
      return scope.level === 'country' || scope.level === 'board';
    case 'school':
      // Country admins, state admins, board admins, principals.
      return (
        scope.level === 'country' ||
        scope.level === 'state' ||
        scope.level === 'board' ||
        scope.level === 'school'
      );
    case 'teacher':
      // Only the teacher themselves (and country admins for ops).
      return scope.level === 'teacher' || scope.level === 'country';
    case 'me':
      // Parent/student — and country admins for ops.
      return scope.level === 'parent_student' || scope.level === 'country';
    default:
      return false;
  }
}
