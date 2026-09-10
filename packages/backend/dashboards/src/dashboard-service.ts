/**
 * Dashboard Service.
 *
 * The service ties three pieces together:
 *
 *   1. `deriveDashboardScope` — projects JWT claims into a typed scope.
 *   2. `AreaHierarchyResolver` — expands the scope's `areaIds` to include
 *      every descendant area, so a state-scoped user automatically reads
 *      every district inside their state.
 *   3. `DashboardRepository` — runs the aggregate query, filtered to the
 *      expanded scope.
 *
 * This satisfies Requirement 40 AC 9: every dashboard load is restricted
 * to entities within the requesting user's `Area_Hierarchy` and
 * institution scope, with the policy evaluated server-side at the query
 * layer (not just at the route gate).
 */

import type { AreaHierarchyResolver, JwtPayload } from '@proctira/auth';

import type {
  BoardAdminDashboardQuery,
  DashboardRepository,
  RepositoryScope,
  SchoolDashboardQuery,
  StateDashboardQuery,
} from './dashboard-repository.js';
import {
  canAccessVariant,
  deriveDashboardScope,
  type DashboardScope,
  type DashboardVariant,
} from './scope.js';
import type {
  BoardAdminDashboardAggregate,
  CountryDashboardAggregate,
  ParentStudentDashboardAggregate,
  SchoolDashboardAggregate,
  StateDashboardAggregate,
  TeacherDashboardAggregate,
} from './types.js';

/**
 * The forbidden marker is returned by service methods when the JWT scope
 * is allowed to reach the variant but the *requested resource* lies
 * outside the user's Area_Hierarchy / institution / board scope. Routes
 * translate this into HTTP 403.
 *
 * `notFound` is returned when the variant is permitted and the resource
 * is in scope but no aggregate has been computed for it. Routes
 * translate this into HTTP 404.
 *
 * `unauthorizedVariant` is returned when the user's scope level cannot
 * read this variant at all (e.g., teacher hitting board-admin). Routes
 * translate this into HTTP 403.
 */
export type DashboardServiceResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'forbidden'; reason: string }
  | { status: 'not-found' };

export interface DashboardServiceDeps {
  repository: DashboardRepository;
  /** Used to expand a state's `areaId` to all its district / block children. */
  areaResolver: AreaHierarchyResolver;
}

export class DashboardService {
  constructor(private readonly deps: DashboardServiceDeps) {}

  /** Country dashboard. */
  async getCountryDashboard(
    jwt: JwtPayload,
  ): Promise<DashboardServiceResult<CountryDashboardAggregate>> {
    const scope = deriveDashboardScope(jwt);
    const variantCheck = this.checkVariant(scope, 'country');
    if (variantCheck) return variantCheck;

    const repoScope = await this.toRepositoryScope(scope);
    const data = await this.deps.repository.countryDashboard(repoScope);
    return { status: 'ok', data };
  }

  /** State dashboard for the requested state. */
  async getStateDashboard(
    jwt: JwtPayload,
    query: StateDashboardQuery,
  ): Promise<DashboardServiceResult<StateDashboardAggregate>> {
    const scope = deriveDashboardScope(jwt);
    const variantCheck = this.checkVariant(scope, 'state');
    if (variantCheck) return variantCheck;

    const repoScope = await this.toRepositoryScope(scope);

    // Resource-level scope check: the requested stateId must be inside
    // the user's expanded area scope (or the user must be country).
    if (!repoScope.isCountryScope && !(await repoScope.containsArea(query.stateId))) {
      return {
        status: 'forbidden',
        reason: `State '${query.stateId}' is outside the user's Area_Hierarchy scope`,
      };
    }

    const data = await this.deps.repository.stateDashboard(repoScope, query);
    if (!data) return { status: 'not-found' };
    return { status: 'ok', data };
  }

  /** Board admin dashboard for the requested board. */
  async getBoardAdminDashboard(
    jwt: JwtPayload,
    query: BoardAdminDashboardQuery,
  ): Promise<DashboardServiceResult<BoardAdminDashboardAggregate>> {
    const scope = deriveDashboardScope(jwt);
    const variantCheck = this.checkVariant(scope, 'board-admin');
    if (variantCheck) return variantCheck;

    const repoScope = await this.toRepositoryScope(scope);

    // Resource-level scope: country admins can read any board, board
    // admins can only read their own.
    if (!repoScope.isCountryScope && !repoScope.boardIds.includes(query.boardId)) {
      return {
        status: 'forbidden',
        reason: `Board '${query.boardId}' is outside the user's board scope`,
      };
    }

    const data = await this.deps.repository.boardAdminDashboard(repoScope, query);
    if (!data) return { status: 'not-found' };
    return { status: 'ok', data };
  }

  /** School dashboard for the requested institution. */
  async getSchoolDashboard(
    jwt: JwtPayload,
    query: SchoolDashboardQuery,
  ): Promise<DashboardServiceResult<SchoolDashboardAggregate>> {
    const scope = deriveDashboardScope(jwt);
    const variantCheck = this.checkVariant(scope, 'school');
    if (variantCheck) return variantCheck;

    const repoScope = await this.toRepositoryScope(scope);

    // The repository checks both institution and area set — but we also
    // pre-validate that *some* scope path can reach the institution to
    // produce a clean 403 instead of a 404 when the user is logged in
    // but cross-scoping.
    const institutionAuthorized =
      repoScope.isCountryScope || repoScope.institutionIds.includes(query.institutionId);

    if (!institutionAuthorized) {
      // School principals/admins may *also* be authorised by Area_Hierarchy
      // for state directors etc. — defer that decision to the repository
      // (which runs the same area-IN check). If the repo returns null for
      // an authorised area we treat that as 404; otherwise 403.
      const dataIfAreaScope = await this.deps.repository.schoolDashboard(repoScope, query);
      if (dataIfAreaScope === null) {
        return {
          status: 'forbidden',
          reason: `Institution '${query.institutionId}' is outside the user's institution / area scope`,
        };
      }
      return { status: 'ok', data: dataIfAreaScope };
    }

    const data = await this.deps.repository.schoolDashboard(repoScope, query);
    if (!data) return { status: 'not-found' };
    return { status: 'ok', data };
  }

  /** Teacher dashboard for the requesting user. */
  async getTeacherDashboard(
    jwt: JwtPayload,
  ): Promise<DashboardServiceResult<TeacherDashboardAggregate>> {
    const scope = deriveDashboardScope(jwt);
    const variantCheck = this.checkVariant(scope, 'teacher');
    if (variantCheck) return variantCheck;

    const repoScope = await this.toRepositoryScope(scope);
    const data = await this.deps.repository.teacherDashboard(repoScope);
    if (!data) return { status: 'not-found' };
    return { status: 'ok', data };
  }

  /** Parent / student dashboard for the requesting user. */
  async getMeDashboard(
    jwt: JwtPayload,
  ): Promise<DashboardServiceResult<ParentStudentDashboardAggregate>> {
    const scope = deriveDashboardScope(jwt);
    const variantCheck = this.checkVariant(scope, 'me');
    if (variantCheck) return variantCheck;

    const repoScope = await this.toRepositoryScope(scope);
    const data = await this.deps.repository.meDashboard(repoScope);
    if (!data) return { status: 'not-found' };
    return { status: 'ok', data };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /**
   * Project the JWT-derived scope into the repository scope. The
   * route handler does NOT pre-expand descendants; instead it builds a
   * `containsArea(areaId)` closure backed by the `AreaHierarchyResolver`
   * so the repository can ask the resolver per row. This keeps the
   * scope object cheap to build (no hierarchy traversal up front) while
   * still correctly including descendant areas (e.g., a state director
   * scoped to `state-MH` automatically reads aggregates at
   * `district-MH-PUN`).
   */
  private async toRepositoryScope(scope: DashboardScope): Promise<RepositoryScope> {
    const isCountryScope = scope.level === 'country';
    const areaIds = [...scope.areaIds];
    const resolver = this.deps.areaResolver;

    const containsArea = async (areaId: string): Promise<boolean> => {
      if (isCountryScope) return true;
      // A row whose own areaId is one of the user's roots is trivially in scope.
      if (areaIds.includes(areaId)) return true;
      // Otherwise walk the hierarchy: the row is in scope if any of the
      // user's roots is an ancestor of the row's areaId.
      for (const root of areaIds) {
        if (await resolver.isDescendantOrSelf(areaId, root)) {
          return true;
        }
      }
      return false;
    };

    return {
      tenantId: scope.tenantId,
      areaIds,
      institutionIds: [...scope.institutionIds],
      boardIds: [...scope.boardIds],
      userId: scope.userId,
      isCountryScope,
      containsArea,
    };
  }

  private checkVariant(
    scope: DashboardScope,
    variant: DashboardVariant,
  ): DashboardServiceResult<never> | null {
    if (!canAccessVariant(scope, variant)) {
      return {
        status: 'forbidden',
        reason: `Scope '${scope.level}' is not permitted to read the '${variant}' dashboard`,
      };
    }
    return null;
  }
}
