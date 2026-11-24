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
  | 'parent_student'
  // PRC-L451: explicit deny level for unknown/no-role users. Previously such
  // users silently fell through to `parent_student` (fail-open); `none` makes
  // the "deny all dashboards" intent real.
  | 'none';

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
  /**
   * PRC-L451: every dashboard level the user holds (not just the most
   * privileged one). `canAccessVariant` evaluates against this set so a user
   * who is both a principal and a teacher can load both dashboards.
   */
  heldLevels: DashboardScopeLevel[];
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
const COUNTRY_ROLE_IDS = new Set(['system_admin', 'super-admin', 'ministry_admin']);

/** Role IDs that grant a state dashboard, scoped to `roleAssignment.areaId`. */
const STATE_ROLE_IDS = new Set(['state_director', 'state_admin']);

/** Role IDs that grant a board admin dashboard, scoped to a board. */
const BOARD_ADMIN_ROLE_IDS = new Set(['board_admin', 'board_regional_officer']);

/** Role IDs that grant a school dashboard, scoped to an institution. */
const SCHOOL_ROLE_IDS = new Set(['school_admin', 'principal']);

/** Role IDs that grant the teacher dashboard. */
const TEACHER_ROLE_IDS = new Set(['teacher']);

/** Role IDs that grant the parent / student dashboard. */
const PARENT_STUDENT_ROLE_IDS = new Set(['parent', 'student', 'guardian']);

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
  // PRC-L451: also collect *every* level the user holds so canAccessVariant can
  // authorise a multi-role user (e.g. principal + teacher) for all of them, and
  // unknown/no-role users resolve to the explicit `none` deny level.
  const heldLevels: DashboardScopeLevel[] = [];
  if (hasCountry) heldLevels.push('country');
  if (stateRoles.length > 0) heldLevels.push('state');
  if (boardRoles.length > 0) heldLevels.push('board');
  if (schoolRoles.length > 0) heldLevels.push('school');
  if (teacherRoles.length > 0) heldLevels.push('teacher');
  if (parentRoles.length > 0) heldLevels.push('parent_student');

  // The most-privileged held level, or `none` for unknown/absent roles.
  const level: DashboardScopeLevel = heldLevels[0] ?? 'none';

  // Collect area / institution / board IDs across every relevant role.
  const areaIds = new Set<string>();
  const institutionIds = new Set<string>(jwt.institutions ?? []);
  const boardIds = new Set<string>();

  for (const role of stateRoles) areaIds.add(role.areaId);
  // PRC-M591: school/teacher roles are anchored to an *institution*, not an
  // area. Treating their `areaId` as an area-wide grant let a principal read
  // every school in their state (horizontal escalation). Authorise these
  // levels by institutionIds only; area breadth is reserved for state/country.
  for (const role of schoolRoles) {
    if (role.institutionId) institutionIds.add(role.institutionId);
  }
  for (const role of teacherRoles) {
    if (role.institutionId) institutionIds.add(role.institutionId);
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
    heldLevels,
    areaIds: Array.from(areaIds),
    institutionIds: Array.from(institutionIds),
    boardIds: Array.from(boardIds),
    userId: jwt.sub,
    tenantId: jwt.tenantId,
    roles,
  };
}

/** Dashboard variants exposed by the gateway. */
export type DashboardVariant = 'country' | 'state' | 'board-admin' | 'school' | 'teacher' | 'me';

/**
 * Whether a derived scope is allowed to *load* a given dashboard variant.
 * This is the first gate; per-resource Area_Hierarchy filtering happens
 * after this check.
 *
 * PRC-L451: evaluated against *every* level the user holds (not just the most
 * privileged one), so a principal-and-teacher can load both dashboards, and
 * the `none` level (unknown/absent roles) is denied every variant.
 */
export function canAccessVariant(scope: DashboardScope, variant: DashboardVariant): boolean {
  const levels = scope.heldLevels.length > 0 ? scope.heldLevels : [scope.level];
  const has = (level: DashboardScopeLevel) => levels.includes(level);
  const isCountry = has('country');
  switch (variant) {
    case 'country':
      return isCountry;
    case 'state':
      // Country admins can read any state; state admins can read theirs.
      return isCountry || has('state');
    case 'board-admin':
      // Country admins and explicit board admins.
      return isCountry || has('board');
    case 'school':
      // Country admins, state admins, board admins, principals.
      return isCountry || has('state') || has('board') || has('school');
    case 'teacher':
      // Only the teacher themselves (and country admins for ops).
      return has('teacher') || isCountry;
    case 'me':
      // Parent/student — and country admins for ops.
      return has('parent_student') || isCountry;
    default:
      return false;
  }
}
