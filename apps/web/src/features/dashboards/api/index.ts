/**
 * Dashboard data hooks barrel.
 *
 * Higher-scope hooks (Country / State / Board Admin) live in
 * `./queries.ts` (Task 52.2). The lower-scope hooks (School, Teacher,
 * Parent / Student) live in dedicated files alongside this barrel
 * (Task 52.4). All hooks return a TanStack-Query-shaped envelope
 * (`{ data, isLoading, error }`); Task 60.3 swaps the implementations
 * to call the live API client without changing the call sites.
 */

// ─── Higher-scope hooks (Task 52.2) ──────────────────────────────────────────
export {
  useCountryDashboardData,
  useStateDashboardData,
  useBoardAdminDashboardData,
  useBoardComparisonData,
  useCrossBoardTransferData,
} from './queries';
export {
  COUNTRY_DASHBOARD_MOCK,
  STATE_DASHBOARD_MOCK,
  BOARD_ADMIN_DASHBOARD_MOCK,
  BOARD_COMPARISON_MOCK,
  CROSS_BOARD_TRANSFER_MOCK,
} from './mockData';

// ─── Lower-scope hooks (Task 52.4) ──────────────────────────────────────────
export { useSchoolDashboard, __SCHOOL_DASHBOARD_MOCK__ } from './useSchoolDashboard';
export { useTeacherDashboard, __TEACHER_DASHBOARD_MOCK__ } from './useTeacherDashboard';
export {
  useParentStudentDashboard,
  __PARENT_STUDENT_DASHBOARD_MOCK__,
} from './useParentStudentDashboard';

// ─── Shared types ───────────────────────────────────────────────────────────
export type {
  // Generic
  DashboardQueryResult,
  KpiTrendDirection,
  DashboardKpi,
  // Country
  CountryDashboardData,
  BoardRow,
  StateRow,
  EnrollmentTrendPoint,
  // State
  StateDashboardData,
  DistrictRanking,
  DistrictRow,
  BoardRadarAxis,
  BoardRadarSeries,
  BoardRadarData,
  // Board Admin
  BoardAdminDashboardData,
  RegionRow,
  AffiliationStatus,
  AffiliationCount,
  EnrollmentGrowthPoint,
  ActionItemPriority,
  BoardActionItem,
  // Board Comparison (Task 52.3)
  BoardComparisonData,
  BoardComparisonMetric,
  BoardComparisonMetricId,
  BoardComparisonBoard,
  BoardComparisonTrendPoint,
  BoardComparisonDetailRow,
  // Cross-Board Transfer (Task 52.3)
  CrossBoardTransferData,
  TransferState,
  TransferStateId,
  TransferInstitutionRef,
  TransferApprovalStep,
  TransferApprovalStatus,
  EquivalencyMappingRow,
  EquivalencyMappingStatus,
  TransferDocument,
  // School
  SchoolDashboardData,
  SchoolKpis,
  SchoolActivityItem,
  SchoolPendingTask,
  // Teacher
  TeacherDashboardData,
  TeacherClass,
  TeacherAttendancePending,
  TeacherAssessmentTask,
  // Parent / Student
  ParentStudentDashboardData,
  ParentAttendanceSummary,
  ParentAssessmentResult,
  ParentNotification,
} from './types';
