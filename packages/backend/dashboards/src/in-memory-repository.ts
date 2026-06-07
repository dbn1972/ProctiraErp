/**
 * In-memory dashboard repository.
 *
 * Used by the integration tests in this package and by any service that
 * wants to spin up a dashboard plugin without a real data warehouse
 * (e.g., gateway smoke tests). The implementation models the SQL
 * `WHERE area_id IN (...) AND institution_id IN (...) AND board_id IN
 * (...)` filter that the production Prisma adapter must enforce — the
 * repository will NOT return a row whose area/institution/board lies
 * outside the provided `RepositoryScope`.
 *
 * Test code seeds aggregates via `setStateAggregate`, `setBoardAggregate`,
 * etc. and, optionally, an institution → area map and student → user map
 * so the repository can decide which scope a row belongs to.
 */

import type {
  BoardAdminDashboardQuery,
  DashboardRepository,
  RepositoryScope,
  SchoolDashboardQuery,
  StateDashboardQuery,
} from './dashboard-repository.js';
import type {
  BoardAdminDashboardAggregate,
  CountryDashboardAggregate,
  ParentStudentDashboardAggregate,
  SchoolDashboardAggregate,
  StateDashboardAggregate,
  TeacherDashboardAggregate,
} from './types.js';

/**
 * Seeded record describing which scope an aggregate belongs to. The
 * `tenantId` and the relevant `areaId` / `institutionId` / `boardId` are
 * checked against the `RepositoryScope` before the row is returned.
 */
interface ScopedAggregate<T> {
  tenantId: string;
  areaId?: string;
  institutionId?: string;
  boardId?: string;
  /** For teacher / `me` aggregates: which user the row belongs to. */
  userId?: string;
  data: T;
}

export class InMemoryDashboardRepository implements DashboardRepository {
  private countryAggregates: Map<string, CountryDashboardAggregate> = new Map();
  private stateAggregates: Map<string, ScopedAggregate<StateDashboardAggregate>> = new Map();
  private boardAggregates: Map<string, ScopedAggregate<BoardAdminDashboardAggregate>> = new Map();
  private schoolAggregates: Map<string, ScopedAggregate<SchoolDashboardAggregate>> = new Map();
  private teacherAggregates: Map<string, ScopedAggregate<TeacherDashboardAggregate>> = new Map();
  private parentStudentAggregates: Map<
    string,
    ScopedAggregate<ParentStudentDashboardAggregate>
  > = new Map();

  // ─── Seeders ────────────────────────────────────────────────────────────

  setCountryAggregate(tenantId: string, aggregate: CountryDashboardAggregate): void {
    this.countryAggregates.set(tenantId, aggregate);
  }

  setStateAggregate(
    tenantId: string,
    stateId: string,
    aggregate: StateDashboardAggregate,
  ): void {
    this.stateAggregates.set(this.key(tenantId, stateId), {
      tenantId,
      areaId: stateId,
      data: aggregate,
    });
  }

  setBoardAggregate(
    tenantId: string,
    boardId: string,
    aggregate: BoardAdminDashboardAggregate,
  ): void {
    this.boardAggregates.set(this.key(tenantId, boardId), {
      tenantId,
      boardId,
      data: aggregate,
    });
  }

  setSchoolAggregate(
    tenantId: string,
    institutionId: string,
    areaId: string,
    aggregate: SchoolDashboardAggregate,
  ): void {
    this.schoolAggregates.set(this.key(tenantId, institutionId), {
      tenantId,
      areaId,
      institutionId,
      data: aggregate,
    });
  }

  setTeacherAggregate(
    tenantId: string,
    userId: string,
    institutionId: string,
    areaId: string,
    aggregate: TeacherDashboardAggregate,
  ): void {
    this.teacherAggregates.set(this.key(tenantId, userId), {
      tenantId,
      userId,
      areaId,
      institutionId,
      data: aggregate,
    });
  }

  setParentStudentAggregate(
    tenantId: string,
    userId: string,
    institutionId: string,
    aggregate: ParentStudentDashboardAggregate,
  ): void {
    this.parentStudentAggregates.set(this.key(tenantId, userId), {
      tenantId,
      userId,
      institutionId,
      data: aggregate,
    });
  }

  clear(): void {
    this.countryAggregates.clear();
    this.stateAggregates.clear();
    this.boardAggregates.clear();
    this.schoolAggregates.clear();
    this.teacherAggregates.clear();
    this.parentStudentAggregates.clear();
  }

  // ─── DashboardRepository ────────────────────────────────────────────────

  async countryDashboard(scope: RepositoryScope): Promise<CountryDashboardAggregate> {
    // Country aggregates are global per tenant — only readable when the
    // scope is `country` (the route handler enforces this; we double-check
    // here so a misuse of the repository can't leak data).
    if (!scope.isCountryScope) {
      throw new Error(
        'countryDashboard called with a non-country scope — route handler must reject before reaching here',
      );
    }
    const aggregate = this.countryAggregates.get(scope.tenantId);
    return aggregate ?? this.emptyCountry();
  }

  async stateDashboard(
    scope: RepositoryScope,
    query: StateDashboardQuery,
  ): Promise<StateDashboardAggregate | null> {
    const row = this.stateAggregates.get(this.key(scope.tenantId, query.stateId));
    if (!row) return null;
    if (!(await this.isWithinAreaScope(row.areaId, scope))) return null;
    return row.data;
  }

  async boardAdminDashboard(
    scope: RepositoryScope,
    query: BoardAdminDashboardQuery,
  ): Promise<BoardAdminDashboardAggregate | null> {
    const row = this.boardAggregates.get(this.key(scope.tenantId, query.boardId));
    if (!row) return null;
    if (!this.isWithinBoardScope(row.boardId, scope)) return null;
    return row.data;
  }

  async schoolDashboard(
    scope: RepositoryScope,
    query: SchoolDashboardQuery,
  ): Promise<SchoolDashboardAggregate | null> {
    const row = this.schoolAggregates.get(this.key(scope.tenantId, query.institutionId));
    if (!row) return null;
    if (!(await this.isWithinInstitutionScope(row.institutionId, row.areaId, scope))) {
      return null;
    }
    return row.data;
  }

  async teacherDashboard(
    scope: RepositoryScope,
  ): Promise<TeacherDashboardAggregate | null> {
    const row = this.teacherAggregates.get(this.key(scope.tenantId, scope.userId));
    if (!row) return null;
    return row.data;
  }

  async meDashboard(
    scope: RepositoryScope,
  ): Promise<ParentStudentDashboardAggregate | null> {
    const row = this.parentStudentAggregates.get(this.key(scope.tenantId, scope.userId));
    if (!row) return null;
    return row.data;
  }

  // ─── Internal scope checks ──────────────────────────────────────────────

  private async isWithinAreaScope(
    areaId: string | undefined,
    scope: RepositoryScope,
  ): Promise<boolean> {
    if (scope.isCountryScope) return true;
    if (!areaId) return false;
    // The route handler builds `containsArea` once per request, backed
    // by the `AreaHierarchyResolver`. This walks descendants so a
    // state-scoped user automatically reads district-level rows.
    return scope.containsArea(areaId);
  }

  private isWithinBoardScope(
    boardId: string | undefined,
    scope: RepositoryScope,
  ): boolean {
    if (scope.isCountryScope) return true;
    if (!boardId) return false;
    return scope.boardIds.includes(boardId);
  }

  private async isWithinInstitutionScope(
    institutionId: string | undefined,
    areaId: string | undefined,
    scope: RepositoryScope,
  ): Promise<boolean> {
    if (scope.isCountryScope) return true;
    if (institutionId && scope.institutionIds.includes(institutionId)) return true;
    if (areaId && (await scope.containsArea(areaId))) return true;
    return false;
  }

  private key(tenantId: string, id: string): string {
    return `${tenantId}::${id}`;
  }

  private emptyCountry(): CountryDashboardAggregate {
    return {
      kpis: [],
      boards: [],
      states: [],
      enrollmentTrend: [],
    };
  }
}
