/**
 * selectDefaultDashboardRoute — pure mapping from auth context to a default
 * dashboard route (Task 52.1 / Requirement 40.9 / Design §G, §Q).
 *
 * The unified Frontend_Shell renders many dashboards. When an authenticated
 * user lands on `/app/dashboard` we need to decide which variant becomes the
 * default surface. Server-side RBAC (Design §Q) is the authoritative gate on
 * data access; this function only chooses the *default route* the client
 * lands on based on the JWT-derived `scope` and `roles`.
 *
 * Mapping (from task 52.1):
 *
 * | Trigger              | Default route               |
 * |----------------------|-----------------------------|
 * | scope.level=country  | /app/dashboard/country      |
 * | scope.level=state    | /app/dashboard/state        |
 * | scope.level=board OR | /app/dashboard/board-admin  |
 * |   role=board-admin   |                             |
 * | role=principal       | /app/dashboard/school       |
 * | role=teacher         | /app/dashboard/teacher      |
 * | role=parent / guardian| /parent                     |
 * | role=student         | /student                     |
 * | (none of the above)  | /app/dashboard/me  (fallback)|
 *
 * The fallback is the lowest-privilege surface (`/me`) so that a user holding
 * no matching scope or role still reaches a renderable, server-RBAC-safe
 * page rather than a blank screen or a 403.
 */

/** UserScope levels exposed by `useAuth()` (matches AuthProvider). */
export type DashboardScopeLevel = 'country' | 'state' | 'district' | 'board' | 'school';

/** Minimal shape of `useAuth().user.scope` consumed by the role router. */
export interface RoleRouterScope {
  level: DashboardScopeLevel;
}

/** Inputs to the role-router decision. */
export interface RoleRouterInput {
  /** JWT-derived area scope. `null` when unauthenticated. */
  scope: RoleRouterScope | null | undefined;
  /** JWT-derived role IDs. */
  roles: readonly string[] | null | undefined;
}

/** Canonical dashboard sub-routes under `/app/dashboard`. */
export const DASHBOARD_ROUTES = {
  country: '/app/dashboard/country',
  state: '/app/dashboard/state',
  boardAdmin: '/app/dashboard/board-admin',
  school: '/app/dashboard/school',
  teacher: '/app/dashboard/teacher',
  me: '/app/dashboard/me',
} as const;

/** Parent / guardian / student portal (first-class shell, not staff dashboard). */
export const PARENT_PORTAL_ROUTE = '/parent';
export const STUDENT_PORTAL_ROUTE = '/student';

export type DashboardRoute =
  | (typeof DASHBOARD_ROUTES)[keyof typeof DASHBOARD_ROUTES]
  | typeof PARENT_PORTAL_ROUTE
  | typeof STUDENT_PORTAL_ROUTE;

/**
 * Lowest-privilege accessible dashboard. Used when no scope/role rule
 * matches, satisfying the task's fallback contract:
 *
 *   "Fall back to the lowest-privilege accessible dashboard if the user
 *    holds no matching scope."
 */
export const FALLBACK_ROUTE: DashboardRoute = DASHBOARD_ROUTES.me;

/**
 * Normalises a role identifier so we can match common variants the JWT
 * might emit ("BOARD_ADMIN", "board_admin", "board-admin").
 */
function normaliseRole(role: string): string {
  return role.toLowerCase().replace(/_/g, '-').trim();
}

function rolesContain(
  roles: readonly string[] | null | undefined,
  candidates: readonly string[],
): boolean {
  if (!roles || roles.length === 0) return false;
  const normalised = new Set(roles.map(normaliseRole));
  return candidates.some((c) => normalised.has(c));
}

/**
 * Selects the default dashboard route for the supplied auth context.
 *
 * The decision order is:
 *   1. Country scope wins (highest privilege, ministry-level).
 *   2. State scope.
 *   3. Board scope OR `board-admin` role.
 *   4. `principal` role (school admin), or school scope paired with the
 *      principal role.
 *   5. `teacher` role.
 *   6. `parent` / `guardian` role → parent portal.
 *   6b. `student` role → student portal.
 *   7. Fallback: `/app/dashboard/me`.
 *
 * Server-side policy still gates the data on each route; this function is
 * deliberately client-only and never makes an authorisation decision.
 */
export function selectDefaultDashboardRoute(input: RoleRouterInput): DashboardRoute {
  const { scope, roles } = input;

  // (1) Country-level admin lands on the national dashboard.
  if (scope?.level === 'country') {
    return DASHBOARD_ROUTES.country;
  }

  // (2) State directors land on the state dashboard.
  if (scope?.level === 'state') {
    return DASHBOARD_ROUTES.state;
  }

  // (3) Board admins (by scope or by explicit role) land on the
  // board-admin dashboard. Districts roll up to a board for routing
  // purposes here — the State_Dashboard handles district KPIs inline
  // (Design §G.2), but a user whose only scope is `district` without a
  // matching role would already have fallen through above. We intentionally
  // don't auto-route district scope here because the district view is
  // rendered inside State_Dashboard, not as its own page in this task.
  if (scope?.level === 'board' || rolesContain(roles, ['board-admin'])) {
    return DASHBOARD_ROUTES.boardAdmin;
  }

  // (4) Principals get the school dashboard.
  if (rolesContain(roles, ['principal'])) {
    return DASHBOARD_ROUTES.school;
  }

  // (5) Teachers get the teacher dashboard.
  if (rolesContain(roles, ['teacher'])) {
    return DASHBOARD_ROUTES.teacher;
  }

  // (6) Parents and guardians land on the family portal.
  if (rolesContain(roles, ['parent', 'guardian'])) {
    return PARENT_PORTAL_ROUTE;
  }

  if (rolesContain(roles, ['student'])) {
    return STUDENT_PORTAL_ROUTE;
  }

  // (7) Fallback — lowest-privilege surface.
  return FALLBACK_ROUTE;
}
