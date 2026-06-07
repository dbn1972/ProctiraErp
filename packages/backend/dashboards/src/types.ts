/**
 * Dashboard domain types.
 *
 * These types describe the *aggregate* shapes returned from the six
 * server-side dashboard endpoints (Country, State, Board Admin, School,
 * Teacher, Parent/Student). The shapes mirror the frontend contracts in
 * `apps/web/src/features/dashboards/api/types.ts` so the two surfaces can
 * be wired together by Task 60.3 without further schema work.
 *
 * Requirements:
 *   - 40.1–40.8: per-scope dashboard surfaces.
 *   - 40.9: server-side RBAC + Area_Hierarchy scoping at the query layer.
 */

/** A single KPI tile. */
export interface DashboardKpi {
  id: string;
  label: string;
  value: string;
  delta?: string;
  direction?: 'up' | 'down' | 'flat';
  description?: string;
}

// ─── Country ────────────────────────────────────────────────────────────────

export interface BoardSummaryRow {
  id: string;
  name: string;
  schools: number;
  students: number;
  attendancePercent: number;
  passRatePercent: number;
  pupilTeacherRatio: number;
}

export interface StateSummaryRow {
  id: string;
  name: string;
  schools: number;
  students: number;
  attendancePercent: number;
  passRatePercent: number;
}

export interface EnrollmentTrendPoint {
  year: string;
  cbse: number;
  state: number;
  icse: number;
  ib: number;
}

export interface CountryDashboardAggregate {
  kpis: DashboardKpi[];
  boards: BoardSummaryRow[];
  states: StateSummaryRow[];
  enrollmentTrend: EnrollmentTrendPoint[];
}

// ─── State ──────────────────────────────────────────────────────────────────

export interface DistrictRow {
  id: string;
  name: string;
  schools: number;
  students: number;
  attendancePercent: number;
  passRatePercent: number;
  boardMix: { cbse: number; state: number; icse: number };
}

export interface DistrictRanking {
  district: string;
  passRatePercent: number;
}

export interface StateDashboardAggregate {
  stateId: string;
  stateName: string;
  stateCode: string;
  kpis: DashboardKpi[];
  boards: BoardSummaryRow[];
  districts: DistrictRow[];
  districtRanking: DistrictRanking[];
}

// ─── Board Admin ────────────────────────────────────────────────────────────

export interface RegionRow {
  id: string;
  name: string;
  states: number;
  schools: number;
  students: number;
  classXPassPercent: number;
  classXIIPassPercent: number;
}

export interface AffiliationCount {
  status: 'active' | 'provisional' | 'expiring';
  count: number;
}

export interface EnrollmentGrowthPoint {
  year: string;
  students: number;
}

export interface BoardActionItem {
  id: string;
  title: string;
  description?: string;
  priority: 'high' | 'medium' | 'low';
  dueLabel?: string;
}

export interface BoardAdminDashboardAggregate {
  boardId: string;
  boardName: string;
  boardCode: string;
  kpis: DashboardKpi[];
  regions: RegionRow[];
  affiliations: AffiliationCount[];
  enrollmentGrowth: EnrollmentGrowthPoint[];
  actionItems: BoardActionItem[];
}

// ─── School / Principal ─────────────────────────────────────────────────────

export interface SchoolKpis {
  totalStudents: number;
  attendanceRatePercent: number;
  staffOnDuty: number;
  totalStaff: number;
  pendingApprovals: number;
}

export interface SchoolActivityItem {
  id: string;
  title: string;
  occurredAt: string;
  description?: string;
}

export interface SchoolPendingTask {
  id: string;
  title: string;
  due?: string;
  completed: boolean;
}

export interface SchoolDashboardAggregate {
  institutionId: string;
  institutionName: string;
  kpis: SchoolKpis;
  recentActivity: SchoolActivityItem[];
  pendingTasks: SchoolPendingTask[];
}

// ─── Teacher ────────────────────────────────────────────────────────────────

export interface TeacherClass {
  id: string;
  name: string;
  grade: string;
  studentCount: number;
  institutionId: string;
}

export interface TeacherScheduleItem {
  id: string;
  startsAt: string;
  endsAt: string;
  className: string;
  subject: string;
}

export interface TeacherAttendancePending {
  classId: string;
  className: string;
  scheduledAt: string;
}

export interface TeacherAssessmentTask {
  id: string;
  title: string;
  due?: string;
  completed: boolean;
  className?: string;
}

export interface TeacherDashboardAggregate {
  staffId: string;
  assignedClasses: TeacherClass[];
  todaySchedule: TeacherScheduleItem[];
  attendancePending: TeacherAttendancePending[];
  pendingAssessments: TeacherAssessmentTask[];
}

// ─── Parent / Student ───────────────────────────────────────────────────────

export interface ParentAttendanceSummary {
  ratePercent: number;
  daysPresent: number;
  daysAbsent: number;
  daysLate: number;
}

export interface ParentAssessmentResult {
  id: string;
  subject: string;
  score: number;
  grade: string;
  date: string;
}

export interface ParentNotification {
  id: string;
  sender: string;
  subject: string;
  receivedAt: string;
  unread: boolean;
}

export interface ParentScheduleItem {
  id: string;
  startsAt: string;
  endsAt: string;
  subject: string;
}

export interface ParentStudentDashboardAggregate {
  studentId: string;
  studentName: string;
  gradeLabel: string;
  institutionId: string;
  attendance: ParentAttendanceSummary;
  recentResults: ParentAssessmentResult[];
  schedule: ParentScheduleItem[];
  notifications: ParentNotification[];
}
