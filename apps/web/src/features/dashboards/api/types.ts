/**
 * Shared types for dashboard data hooks.
 *
 * The dashboard pages consume the hooks defined under
 * `apps/web/src/features/dashboards/api/` to render KPI grids, schedules,
 * and task lists. Real network wiring is delivered in Task 60.3 — for
 * now the hooks return mock payloads that mirror the eventual API
 * envelope so the UI can stabilise behind the placeholder data.
 *
 * The shape mirrors the result of a TanStack Query call (`useQuery`)
 * so swapping to the real client in 60.3 only requires replacing the
 * implementation, not the call sites.
 *
 * Types are split into:
 *   - Country / State / Board Admin scope (Task 52.2 — already in
 *     production for the higher-scope dashboards).
 *   - School / Principal / Teacher / Parent-Student scope (Task 52.4
 *     — added with this task).
 */

import type { TimelineItem } from '@proctira/ui-dashboards';

// ─── Generic envelope ───────────────────────────────────────────────────────

/** Generic query-style result so callers can branch on loading/error. */
export interface DashboardQueryResult<TData> {
  data: TData | undefined;
  isLoading: boolean;
  error: Error | null;
}

// ─── KPI primitives shared by Country / State / Board ───────────────────────

export type KpiTrendDirection = 'up' | 'down' | 'flat';

export interface DashboardKpi {
  id: string;
  label: string;
  value: string;
  /** Optional pre-formatted delta (e.g. `"+3.2%"`, `"-118"`). */
  delta?: string;
  /** Direction of the change vs the previous period. */
  direction?: KpiTrendDirection;
  /** Optional descriptive sub-label (e.g. `"Class X + XII"`). */
  description?: string;
}

// ─── Country dashboard ──────────────────────────────────────────────────────

export interface BoardRow {
  id: string;
  name: string;
  schools: string;
  students: string;
  attendance: string;
  passRate: string;
  ptr: string;
}

export interface StateRow {
  id: string;
  name: string;
  schools: string;
  students: string;
  attendance: string;
  passRate: string;
}

export interface EnrollmentTrendPoint {
  year: string;
  cbse: number;
  state: number;
  icse: number;
  ib: number;
}

export interface CountryDashboardData {
  kpis: ReadonlyArray<DashboardKpi>;
  boards: ReadonlyArray<BoardRow>;
  enrollmentTrend: ReadonlyArray<EnrollmentTrendPoint>;
  states: ReadonlyArray<StateRow>;
}

// ─── State dashboard ────────────────────────────────────────────────────────

export interface DistrictRanking {
  district: string;
  passRate: number;
}

export interface DistrictRow {
  id: string;
  name: string;
  schools: string;
  students: string;
  attendance: string;
  passRate: string;
  boardMix: {
    cbse: number;
    state: number;
    icse: number;
  };
}

export interface BoardRadarAxis {
  id: string;
  label: string;
}

export interface BoardRadarSeries {
  id: string;
  label: string;
  values: Record<string, number>;
}

export interface BoardRadarData {
  axes: ReadonlyArray<BoardRadarAxis>;
  series: ReadonlyArray<BoardRadarSeries>;
}

export interface StateDashboardData {
  stateName: string;
  stateCode: string;
  kpis: ReadonlyArray<DashboardKpi>;
  boards: ReadonlyArray<BoardRow>;
  districtRanking: ReadonlyArray<DistrictRanking>;
  boardRadar: BoardRadarData;
  districts: ReadonlyArray<DistrictRow>;
}

// ─── Board Admin dashboard ──────────────────────────────────────────────────

export interface RegionRow {
  id: string;
  name: string;
  states: string;
  schools: string;
  students: string;
  classXPass: string;
  classXIIPass: string;
}

export type AffiliationStatus = 'active' | 'provisional' | 'expiring';

export interface AffiliationCount {
  status: AffiliationStatus;
  count: number;
}

export interface EnrollmentGrowthPoint {
  year: string;
  students: number;
}

export type ActionItemPriority = 'high' | 'medium' | 'low';

export interface BoardActionItem {
  id: string;
  title: string;
  description?: string;
  priority: ActionItemPriority;
  dueLabel?: string;
}

export interface BoardAdminDashboardData {
  boardName: string;
  boardCode: string;
  kpis: ReadonlyArray<DashboardKpi>;
  regions: ReadonlyArray<RegionRow>;
  affiliations: ReadonlyArray<AffiliationCount>;
  enrollmentGrowth: ReadonlyArray<EnrollmentGrowthPoint>;
  actionItems: ReadonlyArray<BoardActionItem>;
}

// ─── Board Comparison (Task 52.3 / Req 40.4) ────────────────────────────────

/** Metric key referenced by both `axes` and the per-board `metrics` map. */
export type BoardComparisonMetricId =
  | 'schools'
  | 'students'
  | 'attendance'
  | 'passRate'
  | 'ptr'
  | 'gpi';

export interface BoardComparisonMetric {
  /** Stable id used as a config-toggle key + radar axis id. */
  id: BoardComparisonMetricId;
  /** Display label (e.g. `"Pass Rate"`). */
  label: string;
  /** Pre-formatted unit suffix used in KPI cards (e.g. `"%"`, `"M"`, `":1"`). */
  unit?: string;
}

export interface BoardComparisonBoard {
  /** Stable code (e.g. `"cbse"`, `"state"`, `"icse"`, `"ib"`). */
  id: string;
  /** Display name (e.g. `"CBSE"`, `"State Boards"`). */
  name: string;
  /**
   * KPI metrics for the board. Values are pre-formatted strings so the
   * KPI cards can render them directly without locale-specific math.
   */
  kpis: Record<BoardComparisonMetricId, string>;
  /**
   * Normalized 0–100 scores per metric, used by the radar visualization.
   * The caller supplies a comparable scale per axis (per Recharts).
   */
  radar: Record<BoardComparisonMetricId, number>;
}

export interface BoardComparisonTrendPoint {
  /** Academic year label (e.g. `"2024-25"`). */
  year: string;
  /** Per-board values keyed by board id. */
  values: Record<string, number>;
}

export interface BoardComparisonDetailRow {
  /** Stable row id (e.g. `"cbse-passRate-2024-25"`). */
  id: string;
  /** Board id this row belongs to (matches `BoardComparisonBoard.id`). */
  boardId: string;
  /** Board display name. */
  boardName: string;
  /** Metric id this row reports. */
  metricId: BoardComparisonMetricId;
  /** Metric display label. */
  metricLabel: string;
  /** Academic year. */
  year: string;
  /** Pre-formatted value (e.g. `"82.3%"`, `"28:1"`). */
  value: string;
}

export interface BoardComparisonData {
  /** All metrics available for selection (radar + tabular comparison). */
  metrics: ReadonlyArray<BoardComparisonMetric>;
  /** All boards available for selection. UI caps the visible set to 4. */
  boards: ReadonlyArray<BoardComparisonBoard>;
  /** Multi-year trend data keyed by board id. */
  trend: ReadonlyArray<BoardComparisonTrendPoint>;
  /** Detailed board × metric × year rows for the comparison table. */
  detail: ReadonlyArray<BoardComparisonDetailRow>;
}

// ─── Cross-Board Transfer (Task 52.3 / Req 40.5) ────────────────────────────

/**
 * Discrete states in the transfer state machine
 * (Design §G.5 — `initiated → source_principal_review → source_board_review
 *  → equivalency_check → destination_board_review → destination_principal_review
 *  → complete | rejected`). The dashboard renders the happy-path states
 * as a stepper and uses `currentStateId` / `completedStateIds` to drive
 * the visual treatment of each step.
 */
export type TransferStateId =
  | 'initiated'
  | 'documents_uploaded'
  | 'equivalency_mapped'
  | 'source_approved'
  | 'destination_approved'
  | 'completed';

export interface TransferState {
  /** Stable id from the state machine. */
  id: TransferStateId;
  /** Display label (e.g. `"Initiated"`, `"Documents Uploaded"`). */
  label: string;
  /** Optional secondary description. */
  description?: string;
}

export interface TransferInstitutionRef {
  id: string;
  name: string;
  /** Board name (e.g. `"Maharashtra State Board"`). */
  board: string;
  /** Optional address line. */
  address?: string;
}

export type TransferApprovalStatus = 'completed' | 'current' | 'pending' | 'rejected';

export interface TransferApprovalStep {
  /** Stable step id. */
  id: string;
  /** Display name (e.g. `"Source Principal"`). */
  name: string;
  /** Approver name or role. */
  approver: string;
  /** Current status of this step. */
  status: TransferApprovalStatus;
  /** Optional date/time the step was last updated. */
  updatedAt?: string;
  /** Optional note (audit message, comment). */
  note?: string;
}

export type EquivalencyMappingStatus = 'mapped' | 'bridge' | 'na';

export interface EquivalencyMappingRow {
  /** Stable row id. */
  id: string;
  /** Subject in the source curriculum. */
  sourceSubject: string;
  /** Equivalent subject in the destination curriculum (or `"—"` when N/A). */
  destinationSubject: string;
  /** Mapping status (mapped / bridge exam / not applicable). */
  status: EquivalencyMappingStatus;
}

export interface TransferDocument {
  /** Stable document id. */
  id: string;
  /** Document name. */
  name: string;
  /** Whether the document has been uploaded. */
  uploaded: boolean;
}

export interface CrossBoardTransferData {
  transferId: string;
  /** Student name (display). */
  studentName: string;
  /** Student id / roll number (display). */
  studentId: string;
  /** Transfer type label (e.g. `"CROSS_BOARD_SAME_STATE"`). */
  transferType: string;
  /** Reason for transfer. */
  reason?: string;
  /** ISO date string when the transfer was requested. */
  requestedAt?: string;
  /** Source institution. */
  source: TransferInstitutionRef;
  /** Destination institution. */
  destination: TransferInstitutionRef;
  /** Ordered states in the state machine (stepper). */
  states: ReadonlyArray<TransferState>;
  /** Currently active state (drives the stepper highlight). */
  currentStateId: TransferStateId;
  /** Set of states already completed. */
  completedStateIds: ReadonlyArray<TransferStateId>;
  /** Approval steps configured for this transfer (each tied to an approver). */
  approvals: ReadonlyArray<TransferApprovalStep>;
  /** Equivalency mapping rows (source curriculum → destination curriculum). */
  equivalency: ReadonlyArray<EquivalencyMappingRow>;
  /** Required documents and their upload status. */
  documents: ReadonlyArray<TransferDocument>;
  /**
   * Approver identifier of the user currently authorised to act on the
   * transfer (matches an entry in `approvals[].id`). The page disables
   * the action buttons unless `currentApprover` matches the active step.
   */
  currentApprover?: string;
}

// ─── School / Principal (Task 52.4 / Req 40.6) ──────────────────────────────

export interface SchoolKpis {
  /** Total students currently enrolled at the school. */
  totalStudents: number;
  /** Today's attendance rate as a percentage in [0, 100]. */
  attendanceRate: number;
  /** Staff currently on duty (used in headcount + utilization). */
  staffOnDuty: number;
  /** Total staff headcount. Used to compute utilization. */
  totalStaff: number;
  /** Open approval / action items the principal still owes. */
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

export interface SchoolDashboardData {
  kpis: SchoolKpis;
  recentActivity: ReadonlyArray<SchoolActivityItem>;
  pendingTasks: ReadonlyArray<SchoolPendingTask>;
}

// ─── Teacher (Task 52.4 / Req 40.7) ─────────────────────────────────────────

export interface TeacherClass {
  id: string;
  name: string;
  grade: string;
  studentCount: number;
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

export interface TeacherDashboardData {
  assignedClasses: ReadonlyArray<TeacherClass>;
  todaySchedule: ReadonlyArray<TimelineItem>;
  attendancePending: ReadonlyArray<TeacherAttendancePending>;
  pendingAssessments: ReadonlyArray<TeacherAssessmentTask>;
}

// ─── Parent / Student (Task 52.4 / Req 40.8) ────────────────────────────────

export interface ParentAttendanceSummary {
  /** Attendance rate as a percentage in [0, 100]. */
  ratePercent: number;
  /** Days marked present in the active period. */
  daysPresent: number;
  /** Days marked absent in the active period. */
  daysAbsent: number;
  /** Days marked late in the active period. */
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

export interface ParentStudentDashboardData {
  studentName: string;
  gradeLabel: string;
  attendance: ParentAttendanceSummary;
  recentResults: ReadonlyArray<ParentAssessmentResult>;
  schedule: ReadonlyArray<TimelineItem>;
  notifications: ReadonlyArray<ParentNotification>;
}
