/**
 * @proctira/backend-dashboards — server-side dashboard data service.
 *
 * Provides the six role-scoped dashboard endpoints (Country, State,
 * Board Admin, School, Teacher, Parent/Student) with RBAC and
 * Area_Hierarchy scoping enforced at the query layer (Requirement 40
 * AC 9). Consumers wire the plugin into the API gateway after the auth
 * plugin so JWT claims are available on the request.
 */

export { dashboardsPlugin } from './dashboards-plugin.js';
export type { DashboardsPluginOptions } from './dashboards-plugin.js';

export { DashboardService } from './dashboard-service.js';
export type {
  DashboardServiceDeps,
  DashboardServiceResult,
} from './dashboard-service.js';

export { registerDashboardRoutes } from './routes.js';
export type { DashboardRoutesOptions } from './routes.js';

export {
  deriveDashboardScope,
  canAccessVariant,
} from './scope.js';
export type {
  DashboardScope,
  DashboardScopeLevel,
  DashboardVariant,
} from './scope.js';

export { InMemoryDashboardRepository } from './in-memory-repository.js';
export type {
  DashboardRepository,
  RepositoryScope,
  StateDashboardQuery,
  BoardAdminDashboardQuery,
  SchoolDashboardQuery,
} from './dashboard-repository.js';

export type {
  DashboardKpi,
  CountryDashboardAggregate,
  StateDashboardAggregate,
  BoardAdminDashboardAggregate,
  SchoolDashboardAggregate,
  TeacherDashboardAggregate,
  ParentStudentDashboardAggregate,
  StateSummaryRow,
  BoardSummaryRow,
  EnrollmentTrendPoint,
  DistrictRow,
  DistrictRanking,
  RegionRow,
  AffiliationCount,
  EnrollmentGrowthPoint,
  BoardActionItem,
  SchoolKpis,
  SchoolActivityItem,
  SchoolPendingTask,
  TeacherClass,
  TeacherScheduleItem,
  TeacherAttendancePending,
  TeacherAssessmentTask,
  ParentAttendanceSummary,
  ParentAssessmentResult,
  ParentNotification,
  ParentScheduleItem,
} from './types.js';
