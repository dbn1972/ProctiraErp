/**
 * Dashboard Repository Interface.
 *
 * Concrete implementations (Prisma in production, in-memory for tests)
 * read aggregates from the data warehouse. Every read is **filter-first**:
 * the repository receives a `RepositoryScope` describing the area,
 * institution, board, and tenant constraints derived from the JWT claims,
 * and returns only rows matching the constraints. This is the SQL `WHERE
 * area_id IN (...) AND institution_id IN (...)` enforcement that satisfies
 * Requirement 40 acceptance criterion 9.
 *
 * The repository is *not* trusted to enforce authorisation by itself —
 * the route handler always derives the scope from the verified JWT before
 * calling the repository, and the in-memory implementation includes a
 * defensive assertion to catch test bugs that bypass the scope filter.
 */

import type {
  BoardAdminDashboardAggregate,
  CountryDashboardAggregate,
  ParentStudentDashboardAggregate,
  SchoolDashboardAggregate,
  StateDashboardAggregate,
  TeacherDashboardAggregate,
} from './types.js';

/**
 * Authorised scope passed from the route handler down to the repository.
 *
 * `areaIds`, `institutionIds`, and `boardIds` are the **roots** of the
 * user's reach. The repository decides if a row's `areaId` is within
 * scope via `containsArea()`, which calls back into the
 * `AreaHierarchyResolver` so that descendants of the user's areas
 * are included automatically (e.g., a state director scoped to
 * `state-MH` can read aggregates tagged at `district-MH-PUN`).
 *
 * In production, the Prisma adapter for this repository runs the
 * equivalent SQL filter:
 *
 *     WHERE area_id IN (
 *       SELECT id FROM area WHERE path LIKE ANY(:userAreaPaths)
 *     )
 *
 * The in-memory implementation uses `containsArea()` row-by-row.
 */
export interface RepositoryScope {
  tenantId: string;
  /**
   * Root area IDs the user is bound to (NOT pre-expanded). For country
   * scope this is empty — `isCountryScope` carries that signal instead.
   */
  areaIds: string[];
  /** Institution IDs the user is bound to (empty == any). */
  institutionIds: string[];
  /** Board IDs the user administers (empty == any). */
  boardIds: string[];
  /** User who is making the request — used for `me`-style reads. */
  userId: string;
  /** Whether the request originated from a country-level role. */
  isCountryScope: boolean;
  /**
   * Returns true when `areaId` is inside the user's area scope, walking
   * the `AreaHierarchyResolver` to honour descendants. Country scopes
   * always return true. The route handler builds this closure once per
   * request so the repository never sees the resolver directly.
   */
  containsArea: (areaId: string) => Promise<boolean>;
}

/**
 * Filter parameters specific to the State endpoint.
 */
export interface StateDashboardQuery {
  /** Specific state requested (`area_id`). Required. */
  stateId: string;
}

/**
 * Filter parameters specific to the Board Admin endpoint.
 */
export interface BoardAdminDashboardQuery {
  /** Specific board requested (`board_id`). Required. */
  boardId: string;
}

/**
 * Filter parameters specific to the School endpoint.
 */
export interface SchoolDashboardQuery {
  /** The institution being inspected. Required. */
  institutionId: string;
}

/**
 * The data-access contract used by every dashboard route.
 */
export interface DashboardRepository {
  countryDashboard(scope: RepositoryScope): Promise<CountryDashboardAggregate>;

  stateDashboard(
    scope: RepositoryScope,
    query: StateDashboardQuery,
  ): Promise<StateDashboardAggregate | null>;

  boardAdminDashboard(
    scope: RepositoryScope,
    query: BoardAdminDashboardQuery,
  ): Promise<BoardAdminDashboardAggregate | null>;

  schoolDashboard(
    scope: RepositoryScope,
    query: SchoolDashboardQuery,
  ): Promise<SchoolDashboardAggregate | null>;

  teacherDashboard(scope: RepositoryScope): Promise<TeacherDashboardAggregate | null>;

  meDashboard(scope: RepositoryScope): Promise<ParentStudentDashboardAggregate | null>;
}
