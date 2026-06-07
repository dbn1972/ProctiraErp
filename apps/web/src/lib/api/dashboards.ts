/**
 * Dashboard API client (Task 60.3).
 *
 * Wraps the six server-side dashboard endpoints exposed by
 * `@proctira/backend-dashboards` (Country, State, Board Admin, School,
 * Teacher, Parent / Student) into browser-friendly fetchers and maps
 * the raw aggregate shapes returned by the service onto the formatted
 * shapes expected by the dashboard widgets in
 * `apps/web/src/features/dashboards/api/types.ts`.
 *
 * Endpoint layout (after the gateway service router prefixes
 * `/api/v1`):
 *
 *   GET /api/v1/dashboards/country
 *   GET /api/v1/dashboards/state/:stateId
 *   GET /api/v1/dashboards/board-admin/:boardId
 *   GET /api/v1/dashboards/school/:institutionId
 *   GET /api/v1/dashboards/teacher
 *   GET /api/v1/dashboards/me
 *
 * For Board Comparison + Cross-Board Transfer the data warehouse and
 * workflow services own the canonical response. The frontend currently
 * derives them from the country/state aggregates plus the workflow
 * service; until those endpoints land we keep the contract here so the
 * hook code reads the same way as the rest of the dashboards.
 */

import {
  BrowserGatewayError,
  browserGatewayFetch,
} from './browser-gateway';
import type {
  BoardAdminDashboardData,
  BoardComparisonData,
  BoardRow,
  CountryDashboardData,
  CrossBoardTransferData,
  DashboardKpi,
  DistrictRanking,
  DistrictRow,
  EnrollmentTrendPoint,
  ParentStudentDashboardData,
  RegionRow,
  SchoolDashboardData,
  StateDashboardData,
  StateRow,
  TeacherDashboardData,
} from '@/features/dashboards/api/types';

// ─── Backend aggregate shapes (mirrors @proctira/backend-dashboards) ────────

interface BackendDashboardKpi {
  id: string;
  label: string;
  value: string;
  delta?: string;
  direction?: 'up' | 'down' | 'flat';
  description?: string;
}

interface BackendBoardSummaryRow {
  id: string;
  name: string;
  schools: number;
  students: number;
  attendancePercent: number;
  passRatePercent: number;
  pupilTeacherRatio: number;
}

interface BackendStateSummaryRow {
  id: string;
  name: string;
  schools: number;
  students: number;
  attendancePercent: number;
  passRatePercent: number;
}

interface BackendEnrollmentTrendPoint {
  year: string;
  cbse: number;
  state: number;
  icse: number;
  ib: number;
}

interface BackendCountryAggregate {
  kpis: BackendDashboardKpi[];
  boards: BackendBoardSummaryRow[];
  states: BackendStateSummaryRow[];
  enrollmentTrend: BackendEnrollmentTrendPoint[];
}

interface BackendDistrictRow {
  id: string;
  name: string;
  schools: number;
  students: number;
  attendancePercent: number;
  passRatePercent: number;
  boardMix: { cbse: number; state: number; icse: number };
}

interface BackendDistrictRanking {
  district: string;
  passRatePercent: number;
}

interface BackendStateAggregate {
  stateId: string;
  stateName: string;
  stateCode: string;
  kpis: BackendDashboardKpi[];
  boards: BackendBoardSummaryRow[];
  districts: BackendDistrictRow[];
  districtRanking: BackendDistrictRanking[];
}

interface BackendRegionRow {
  id: string;
  name: string;
  states: number;
  schools: number;
  students: number;
  classXPassPercent: number;
  classXIIPassPercent: number;
}

interface BackendBoardAdminAggregate {
  boardId: string;
  boardName: string;
  boardCode: string;
  kpis: BackendDashboardKpi[];
  regions: BackendRegionRow[];
  affiliations: ReadonlyArray<{
    status: 'active' | 'provisional' | 'expiring';
    count: number;
  }>;
  enrollmentGrowth: ReadonlyArray<{ year: string; students: number }>;
  actionItems: ReadonlyArray<{
    id: string;
    title: string;
    description?: string;
    priority: 'high' | 'medium' | 'low';
    dueLabel?: string;
  }>;
}

interface BackendSchoolAggregate {
  institutionId: string;
  institutionName: string;
  kpis: {
    totalStudents: number;
    attendanceRatePercent: number;
    staffOnDuty: number;
    totalStaff: number;
    pendingApprovals: number;
  };
  recentActivity: ReadonlyArray<{
    id: string;
    title: string;
    occurredAt: string;
    description?: string;
  }>;
  pendingTasks: ReadonlyArray<{
    id: string;
    title: string;
    due?: string;
    completed: boolean;
  }>;
}

interface BackendTeacherScheduleItem {
  id: string;
  startsAt: string;
  endsAt: string;
  className: string;
  subject: string;
}

interface BackendTeacherAggregate {
  staffId: string;
  assignedClasses: ReadonlyArray<{
    id: string;
    name: string;
    grade: string;
    studentCount: number;
    institutionId: string;
  }>;
  todaySchedule: ReadonlyArray<BackendTeacherScheduleItem>;
  attendancePending: ReadonlyArray<{
    classId: string;
    className: string;
    scheduledAt: string;
  }>;
  pendingAssessments: ReadonlyArray<{
    id: string;
    title: string;
    due?: string;
    completed: boolean;
    className?: string;
  }>;
}

interface BackendParentScheduleItem {
  id: string;
  startsAt: string;
  endsAt: string;
  subject: string;
}

interface BackendParentStudentAggregate {
  studentId: string;
  studentName: string;
  gradeLabel: string;
  institutionId: string;
  attendance: {
    ratePercent: number;
    daysPresent: number;
    daysAbsent: number;
    daysLate: number;
  };
  recentResults: ReadonlyArray<{
    id: string;
    subject: string;
    score: number;
    grade: string;
    date: string;
  }>;
  schedule: ReadonlyArray<BackendParentScheduleItem>;
  notifications: ReadonlyArray<{
    id: string;
    sender: string;
    subject: string;
    receivedAt: string;
    unread: boolean;
  }>;
}

// ─── Formatting helpers ─────────────────────────────────────────────────────

const numberFormatter = new Intl.NumberFormat('en-US');

/** Formats a count like 248_456 → "248,456" or 12_500_000 → "12.5M". */
function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 100_000) return `${(n / 1_000).toFixed(0)}K`;
  return numberFormatter.format(Math.round(n));
}

/** Formats a percentage to one decimal place, e.g. 91.234 → "91.2%". */
function formatPercent(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

/** Formats a pupil-teacher ratio, e.g. 28 → "28:1". */
function formatRatio(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `${Math.round(n)}:1`;
}

function mapKpi(k: BackendDashboardKpi): DashboardKpi {
  return { ...k };
}

function mapBoardRow(row: BackendBoardSummaryRow): BoardRow {
  return {
    id: row.id,
    name: row.name,
    schools: formatCount(row.schools),
    students: formatCount(row.students),
    attendance: formatPercent(row.attendancePercent),
    passRate: formatPercent(row.passRatePercent),
    ptr: formatRatio(row.pupilTeacherRatio),
  };
}

function mapStateRow(row: BackendStateSummaryRow): StateRow {
  return {
    id: row.id,
    name: row.name,
    schools: formatCount(row.schools),
    students: formatCount(row.students),
    attendance: formatPercent(row.attendancePercent),
    passRate: formatPercent(row.passRatePercent),
  };
}

function mapDistrictRow(row: BackendDistrictRow): DistrictRow {
  return {
    id: row.id,
    name: row.name,
    schools: formatCount(row.schools),
    students: formatCount(row.students),
    attendance: formatPercent(row.attendancePercent),
    passRate: formatPercent(row.passRatePercent),
    boardMix: row.boardMix,
  };
}

function mapDistrictRanking(row: BackendDistrictRanking): DistrictRanking {
  return { district: row.district, passRate: row.passRatePercent };
}

function mapRegionRow(row: BackendRegionRow): RegionRow {
  return {
    id: row.id,
    name: row.name,
    states: numberFormatter.format(row.states),
    schools: formatCount(row.schools),
    students: formatCount(row.students),
    classXPass: formatPercent(row.classXPassPercent),
    classXIIPass: formatPercent(row.classXIIPassPercent),
  };
}

function mapEnrollmentTrend(p: BackendEnrollmentTrendPoint): EnrollmentTrendPoint {
  return { ...p };
}

// ─── Mappers ────────────────────────────────────────────────────────────────

export function mapCountryAggregate(
  agg: BackendCountryAggregate,
): CountryDashboardData {
  return {
    kpis: agg.kpis.map(mapKpi),
    boards: agg.boards.map(mapBoardRow),
    states: agg.states.map(mapStateRow),
    enrollmentTrend: agg.enrollmentTrend.map(mapEnrollmentTrend),
  };
}

export function mapStateAggregate(
  agg: BackendStateAggregate,
): StateDashboardData {
  return {
    stateName: agg.stateName,
    stateCode: agg.stateCode,
    kpis: agg.kpis.map(mapKpi),
    boards: agg.boards.map(mapBoardRow),
    districtRanking: agg.districtRanking.map(mapDistrictRanking),
    boardRadar: {
      // The backend does not return a pre-built radar yet; derive it from
      // the board summary so the UI does not show an empty radar.
      axes: [
        { id: 'enrollment', label: 'Enrollment' },
        { id: 'attendance', label: 'Attendance' },
        { id: 'passRate', label: 'Pass Rate' },
      ],
      series: agg.boards.map((b) => ({
        id: b.id,
        label: b.name,
        values: {
          enrollment: clampPct(b.students > 0 ? scoreFromCount(b.students) : 0),
          attendance: b.attendancePercent,
          passRate: b.passRatePercent,
        },
      })),
    },
    districts: agg.districts.map(mapDistrictRow),
  };
}

export function mapBoardAdminAggregate(
  agg: BackendBoardAdminAggregate,
): BoardAdminDashboardData {
  return {
    boardName: agg.boardName,
    boardCode: agg.boardCode,
    kpis: agg.kpis.map(mapKpi),
    regions: agg.regions.map(mapRegionRow),
    affiliations: agg.affiliations.map((a) => ({ ...a })),
    enrollmentGrowth: agg.enrollmentGrowth.map((p) => ({ ...p })),
    actionItems: agg.actionItems.map((a) => ({ ...a })),
  };
}

export function mapSchoolAggregate(
  agg: BackendSchoolAggregate,
): SchoolDashboardData {
  return {
    kpis: {
      totalStudents: agg.kpis.totalStudents,
      attendanceRate: agg.kpis.attendanceRatePercent,
      staffOnDuty: agg.kpis.staffOnDuty,
      totalStaff: agg.kpis.totalStaff,
      pendingApprovals: agg.kpis.pendingApprovals,
    },
    recentActivity: agg.recentActivity.map((a) => ({ ...a })),
    pendingTasks: agg.pendingTasks.map((t) => ({ ...t })),
  };
}

export function mapTeacherAggregate(
  agg: BackendTeacherAggregate,
): TeacherDashboardData {
  return {
    assignedClasses: agg.assignedClasses.map((c) => ({
      id: c.id,
      name: c.name,
      grade: c.grade,
      studentCount: c.studentCount,
    })),
    todaySchedule: agg.todaySchedule.map((s) => ({
      id: s.id,
      time: `${formatClock(s.startsAt)} — ${formatClock(s.endsAt)}`,
      title: `${s.className} — ${s.subject}`,
      description: s.subject,
      status: scheduleStatus(s.startsAt, s.endsAt),
    })),
    attendancePending: agg.attendancePending.map((p) => ({ ...p })),
    pendingAssessments: agg.pendingAssessments.map((p) => ({ ...p })),
  };
}

export function mapParentStudentAggregate(
  agg: BackendParentStudentAggregate,
): ParentStudentDashboardData {
  return {
    studentName: agg.studentName,
    gradeLabel: agg.gradeLabel,
    attendance: { ...agg.attendance },
    recentResults: agg.recentResults.map((r) => ({ ...r })),
    schedule: agg.schedule.map((s) => ({
      id: s.id,
      time: formatClock(s.startsAt),
      title: s.subject,
      description: s.subject,
      status: scheduleStatus(s.startsAt, s.endsAt),
    })),
    notifications: agg.notifications.map((n) => ({ ...n })),
  };
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

/**
 * Roughly normalise a student count onto a 0–100 scale for the radar
 * display. Real production code will let the data warehouse pre-compute
 * a comparable score; this is a best-effort fallback so the
 * <RadarComparison> doesn't render an empty axis when wired live.
 */
function scoreFromCount(students: number): number {
  // log10-scale: 1 → 0, 1e7 → 100. This is good enough for visual ranking.
  if (students <= 1) return 0;
  return Math.min(100, Math.round((Math.log10(students) / 7) * 100));
}

function formatClock(iso: string): string {
  // Accepts either an ISO 8601 string or a `HH:mm` literal — the backend
  // currently emits ISO times for schedule entries. Falls back to the
  // input on parse failure so the widget renders something sensible.
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function scheduleStatus(
  startsAt: string,
  endsAt: string,
): 'completed' | 'active' | 'upcoming' {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  const now = Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return 'upcoming';
  if (now < start) return 'upcoming';
  if (now >= end) return 'completed';
  return 'active';
}

// ─── Public fetchers ────────────────────────────────────────────────────────

export async function fetchCountryDashboard(signal?: AbortSignal): Promise<CountryDashboardData> {
  const agg = await browserGatewayFetch<BackendCountryAggregate>(
    '/dashboards/country',
    { signal },
  );
  return mapCountryAggregate(agg);
}

export async function fetchStateDashboard(
  stateId: string,
  signal?: AbortSignal,
): Promise<StateDashboardData> {
  const agg = await browserGatewayFetch<BackendStateAggregate>(
    `/dashboards/state/${encodeURIComponent(stateId)}`,
    { signal },
  );
  return mapStateAggregate(agg);
}

export async function fetchBoardAdminDashboard(
  boardId: string,
  signal?: AbortSignal,
): Promise<BoardAdminDashboardData> {
  const agg = await browserGatewayFetch<BackendBoardAdminAggregate>(
    `/dashboards/board-admin/${encodeURIComponent(boardId)}`,
    { signal },
  );
  return mapBoardAdminAggregate(agg);
}

export async function fetchSchoolDashboard(
  institutionId: string,
  signal?: AbortSignal,
): Promise<SchoolDashboardData> {
  const agg = await browserGatewayFetch<BackendSchoolAggregate>(
    `/dashboards/school/${encodeURIComponent(institutionId)}`,
    { signal },
  );
  return mapSchoolAggregate(agg);
}

export async function fetchTeacherDashboard(
  signal?: AbortSignal,
): Promise<TeacherDashboardData> {
  const agg = await browserGatewayFetch<BackendTeacherAggregate>(
    '/dashboards/teacher',
    { signal },
  );
  return mapTeacherAggregate(agg);
}

export async function fetchParentStudentDashboard(
  signal?: AbortSignal,
): Promise<ParentStudentDashboardData> {
  const agg = await browserGatewayFetch<BackendParentStudentAggregate>(
    '/dashboards/me',
    { signal },
  );
  return mapParentStudentAggregate(agg);
}

/**
 * Board Comparison + Cross-Board Transfer endpoints have not landed in
 * the gateway yet (they need the data warehouse rollup + workflow
 * service detail view to ship first). Re-export typed stubs that throw
 * a recognisable error so the hooks fall back to the deterministic mock
 * payload until those endpoints are wired up.
 */
export async function fetchBoardComparison(
  _boardCodes?: ReadonlyArray<string>,
  _signal?: AbortSignal,
): Promise<BoardComparisonData> {
  throw new BrowserGatewayError({
    status: 501,
    code: 'NOT_IMPLEMENTED',
    message: 'Board comparison endpoint pending data-warehouse rollup',
  });
}

export async function fetchCrossBoardTransfer(
  _transferId?: string,
  _signal?: AbortSignal,
): Promise<CrossBoardTransferData> {
  throw new BrowserGatewayError({
    status: 501,
    code: 'NOT_IMPLEMENTED',
    message: 'Cross-board transfer endpoint pending workflow detail view',
  });
}

export { BrowserGatewayError };
