/**
 * Dashboard preview-state data fixtures (Task 8.1, `principal-dashboard-parity`).
 *
 * The dashboard home page (`apps/web/src/app/(dashboard)/page.tsx`) fetches
 * exactly six data sources in one `Promise.all`:
 *
 *   [institutions, students, staff, periods, approvals, roleDashboardResult] =
 *     await Promise.all([
 *       listInstitutionsPage({ pageSize: 1 }).catch(() => null),
 *       listStudents({ pageSize: 1 }).catch(() => null),
 *       listStaff({ pageSize: 1 }).catch(() => null),
 *       listAcademicPeriods().catch(() => null),
 *       listPendingApprovals().catch(() => null),
 *       getRoleDashboard(role).catch(() => ({ dashboard: null, source: 'scaffold', status: 503 })),
 *     ]);
 *
 * This module fabricates that same six-value tuple for each of the five
 * preview states (`PreviewState`, `./previewStateCookie`) a permissioned
 * admin/principal can force the dashboard into (Requirement 6):
 *
 *   - Filled       (Req 6.3) — every source succeeds with realistic data
 *   - No approvals (Req 6.4) — every source succeeds except `approvals: []`
 *   - Degraded     (Req 6.5) — the three KPI list calls fail, everything else succeeds
 *   - Error        (Req 6.6/6.7) — every source fails
 *   - Loading      (Req 6.6) — handled separately via `createNeverResolvingDashboardFetch`,
 *                              since "loading" has no data shape, only a pending promise
 *
 * Scope: this module is fixture data ONLY. It does not import, read, or
 * modify `apps/web/src/app/(dashboard)/page.tsx` — wiring `resolvePreviewOverride()`
 * and these fixtures into that page's data-fetch layer is Task 8.2, a
 * separate task. Nothing here changes the real (non-preview) data path.
 *
 * Why hand-constructed `RoleDashboard` values instead of importing
 * `buildRoleDashboard`/`DASHBOARDS` from `@proctira/backend-report`:
 * `apps/web` does not depend on that package today (confirmed — it is not
 * listed in `apps/web/package.json`, and no other file under `apps/web/src`
 * imports from it). Adding that dependency just to borrow a handful of card
 * ids/titles/hints would introduce a new cross-boundary (web → backend)
 * dependency for a purely cosmetic fixture. Instead, `FIXTURE_DASHBOARD_SPECS`
 * below mirrors `DASHBOARDS` in `packages/backend/report/src/dashboards.ts`
 * verbatim (same card ids, titles, hints, for every role) and
 * `FIXTURE_ROLE_VALUES` mirrors the shape of that module's `valuesForRole()`
 * output (same card-id keys). If the real `DASHBOARDS`/`valuesForRole` ever
 * change, this fixture will drift and should be updated to match — there is
 * no import binding the two together.
 */
import type { AcademicPeriod } from '@/lib/institutions/types';
import type { DashboardRole, RoleDashboard, ScaffoldDataSource } from '@/lib/api/reports';
import type { WorkflowApproval } from '@/lib/api/workflows';

import type { PreviewState } from './previewStateCookie';

/**
 * The six real dashboard data sources, fabricated for a preview state.
 *
 * Field shapes are the *minimal* subset of the real gateway-client return
 * types that `page.tsx` actually reads today:
 *   - `institutions.totalItems`      (real: `listInstitutionsPage()`'s `{ data, totalItems }`)
 *   - `students.meta.totalItems`     (real: `StudentListResponse`)
 *   - `staff.meta.totalItems`        (real: `StaffListResponse`)
 *   - `periods`                      (real: `AcademicPeriod[]`, unchanged)
 *   - `approvals`                    (real: `WorkflowApproval[]`, unchanged)
 *   - `roleDashboardResult`          (real: `getRoleDashboard()`'s return shape, minus the optional `error` field page.tsx never reads)
 */
export interface DashboardFixtureData {
  institutions: { totalItems: number } | null;
  students: { meta: { totalItems: number } } | null;
  staff: { meta: { totalItems: number } } | null;
  periods: AcademicPeriod[] | null;
  approvals: WorkflowApproval[] | null;
  roleDashboardResult: {
    dashboard: RoleDashboard | null;
    source: ScaffoldDataSource;
    status: number;
  };
}

// ---------------------------------------------------------------------------
// Filled-state building blocks
// ---------------------------------------------------------------------------

/** Plausible non-empty counts backing the "Filled" KPI cards and role cards. */
const FIXTURE_COUNTS = {
  institutions: 3,
  students: 620,
  staff: 71,
  enrolments: 604,
  attendancePercent: 92.5,
  todayAttendancePercent: 94.2,
  openInvoices: 18,
  feesCollectedCents: 84_500_000,
  feeCollectedThisMonthCents: 12_400_000,
  linkedChildren: 2,
  pendingAdmissionsCount: 12,
  openHealthIncidentsCount: 3,
} as const;

function fmtCount(n: number): string {
  return new Intl.NumberFormat('en-IN').format(n);
}

function fmtPct(n: number): string {
  return `${n}%`;
}

function fmtMoneyCents(cents: number): string {
  return `₹${new Intl.NumberFormat('en-IN').format(Math.round(cents / 100))}`;
}

/**
 * Mirrors `DASHBOARDS` in `packages/backend/report/src/dashboards.ts` — same
 * card ids, titles, and hints for every role (not just principal), so this
 * fixture stays correct regardless of which role `detectDashboardRole()`
 * resolves for the session that activated the preview.
 */
const FIXTURE_DASHBOARD_SPECS: Record<
  DashboardRole,
  { title: string; cards: Array<{ id: string; title: string; hint: string }> }
> = {
  board: {
    title: 'Board dashboard',
    cards: [
      { id: 'board-schools', title: 'Schools', hint: 'Institutions on this board' },
      { id: 'board-enrolment', title: 'Enrolment', hint: 'Headcount across schools' },
      { id: 'board-fees', title: 'Fees collected', hint: 'Succeeded payments' },
      { id: 'board-attendance', title: 'Attendance', hint: 'Present-like share' },
    ],
  },
  principal: {
    title: 'Principal dashboard',
    cards: [
      {
        id: 'principal-attendance',
        title: 'Today attendance',
        hint: 'Campus present % (today)',
      },
      {
        id: 'principal-fees-month',
        title: 'Fees collected this month',
        hint: 'Succeeded payments this month',
      },
      {
        id: 'principal-admissions-pending',
        title: 'Pending admissions',
        hint: 'Applications pending or under review',
      },
      {
        id: 'principal-health-incidents',
        title: 'Open health incidents',
        hint: 'Nurse incidents still open',
      },
    ],
  },
  teacher: {
    title: 'Teacher dashboard',
    cards: [
      { id: 'teacher-students', title: 'Roster size', hint: 'Students in tenant' },
      { id: 'teacher-attendance', title: 'Period attendance', hint: 'Marked present share' },
      { id: 'teacher-enrolment', title: 'Active enrolments', hint: 'Current enrolments' },
      { id: 'teacher-dues', title: 'Open invoices', hint: 'Fee invoices still open' },
    ],
  },
  staff: {
    title: 'Staff dashboard',
    cards: [
      { id: 'staff-students', title: 'Students', hint: 'Active student records' },
      { id: 'staff-attendance', title: 'Attendance', hint: 'Campus present share' },
      { id: 'staff-enrolment', title: 'Active enrolments', hint: 'Current enrolments' },
      { id: 'staff-notifications', title: 'Open invoices', hint: 'Fee invoices still open' },
    ],
  },
  parent: {
    title: 'Parent dashboard',
    cards: [
      { id: 'parent-children', title: 'Linked children', hint: 'Active guardian links' },
      { id: 'parent-fees', title: 'Upcoming fees', hint: 'Open invoices' },
      { id: 'parent-students', title: 'Student records', hint: 'Visible roster rows' },
      { id: 'parent-attendance', title: 'Child attendance', hint: 'Present-like share' },
    ],
  },
};

/** Mirrors the card-id keys `valuesForRole()` produces in the same backend module. */
const FIXTURE_ROLE_VALUES: Record<DashboardRole, Record<string, string>> = {
  board: {
    'board-schools': fmtCount(FIXTURE_COUNTS.institutions),
    'board-enrolment': fmtCount(FIXTURE_COUNTS.enrolments),
    'board-fees': fmtMoneyCents(FIXTURE_COUNTS.feesCollectedCents),
    'board-attendance': fmtPct(FIXTURE_COUNTS.attendancePercent),
  },
  principal: {
    'principal-attendance': fmtPct(FIXTURE_COUNTS.todayAttendancePercent),
    'principal-fees-month': fmtMoneyCents(FIXTURE_COUNTS.feeCollectedThisMonthCents),
    'principal-admissions-pending': fmtCount(FIXTURE_COUNTS.pendingAdmissionsCount),
    'principal-health-incidents': fmtCount(FIXTURE_COUNTS.openHealthIncidentsCount),
  },
  teacher: {
    'teacher-students': fmtCount(FIXTURE_COUNTS.students),
    'teacher-attendance': fmtPct(FIXTURE_COUNTS.attendancePercent),
    'teacher-enrolment': fmtCount(FIXTURE_COUNTS.enrolments),
    'teacher-dues': fmtCount(FIXTURE_COUNTS.openInvoices),
  },
  staff: {
    'staff-students': fmtCount(FIXTURE_COUNTS.students),
    'staff-attendance': fmtPct(FIXTURE_COUNTS.attendancePercent),
    'staff-enrolment': fmtCount(FIXTURE_COUNTS.enrolments),
    'staff-notifications': fmtCount(FIXTURE_COUNTS.openInvoices),
  },
  parent: {
    'parent-children': fmtCount(FIXTURE_COUNTS.linkedChildren),
    'parent-fees': fmtCount(FIXTURE_COUNTS.openInvoices),
    'parent-students': fmtCount(FIXTURE_COUNTS.students),
    'parent-attendance': fmtPct(FIXTURE_COUNTS.attendancePercent),
  },
};

/** Builds a fully-populated `RoleDashboard` for the given role (the "Filled" state). */
function buildFilledRoleDashboard(role: DashboardRole): RoleDashboard {
  const spec = FIXTURE_DASHBOARD_SPECS[role];
  const values = FIXTURE_ROLE_VALUES[role];
  return {
    role,
    title: spec.title,
    cards: spec.cards.map((card) => ({
      id: card.id,
      title: card.title,
      hint: card.hint,
      value: values[card.id] ?? '—',
    })),
  };
}

/** One populated, active academic period — the shape `listAcademicPeriods()` returns. */
function buildFilledPeriods(): AcademicPeriod[] {
  return [
    {
      id: 'preview-period-2025-26',
      tenantId: 'preview-tenant',
      name: '2025-26',
      code: 'AY2025-26',
      startDate: '2025-06-01',
      endDate: '2026-05-31',
      status: 'active',
      kind: 'year',
      parentId: null,
      createdAt: '2025-05-01T00:00:00.000Z',
      updatedAt: '2025-05-01T00:00:00.000Z',
    },
  ];
}

/**
 * 2-3 fabricated `WorkflowApproval` rows exercising the approval-category
 * badge fallback logic added in Task 5: one `'transfer'`, one `'leave'`, and
 * one with no `category` at all (the "predates the taxonomy" / uncategorized
 * case Req 5 AC4 requires a defined fallback presentation for).
 */
function buildFilledApprovals(): WorkflowApproval[] {
  return [
    {
      id: 'preview-approval-transfer-1',
      instanceId: 'preview-instance-transfer-1',
      definitionName: 'Student transfer approval',
      subjectType: 'student_transfer',
      subjectId: 'preview-transfer-0142',
      stepName: 'District approval',
      requestedAt: '2026-01-15T09:00:00.000Z',
      requestedBy: 'principal@preview.test',
      category: 'transfer',
    },
    {
      id: 'preview-approval-leave-1',
      instanceId: 'preview-instance-leave-1',
      definitionName: 'Staff leave request',
      subjectType: 'staff_leave',
      subjectId: 'preview-leave-9081',
      stepName: 'HR confirmation',
      requestedAt: '2026-01-14T11:30:00.000Z',
      requestedBy: 'teacher@preview.test',
      category: 'leave',
    },
    {
      id: 'preview-approval-uncategorized-1',
      instanceId: 'preview-instance-fee-waiver-1',
      definitionName: 'Fee waiver request',
      subjectType: 'fee_waiver',
      subjectId: 'preview-fee-waiver-2210',
      stepName: 'Accounts review',
      requestedAt: '2026-01-13T08:15:00.000Z',
      requestedBy: 'accounts@preview.test',
      // Deliberately no `category` — exercises the "Uncategorized" fallback.
    },
  ];
}

/** The fully-successful, non-empty fixture every other non-error state derives from. */
function buildFilledFixture(role: DashboardRole): DashboardFixtureData {
  return {
    institutions: { totalItems: FIXTURE_COUNTS.institutions },
    students: { meta: { totalItems: FIXTURE_COUNTS.students } },
    staff: { meta: { totalItems: FIXTURE_COUNTS.staff } },
    periods: buildFilledPeriods(),
    approvals: buildFilledApprovals(),
    roleDashboardResult: {
      dashboard: buildFilledRoleDashboard(role),
      source: 'gateway',
      status: 200,
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds the fabricated six-source dashboard data for a given preview state
 * and role. `'loading'` is intentionally excluded — see
 * `createNeverResolvingDashboardFetch` below.
 *
 * - **filled** (Req 6.3): every source succeeds with realistic, non-empty data.
 * - **no-approvals** (Req 6.4): identical to `filled` except `approvals: []`
 *   — distinguishable from both `degraded` and `error` (neither of which
 *   yields an empty array; both yield `null` for at least one source).
 * - **degraded** (Req 6.5): `institutions`/`students`/`staff` forced to
 *   `null` (their existing "Currently unavailable" branch), while `periods`,
 *   `approvals`, and `roleDashboardResult.dashboard` stay populated — a
 *   genuine partial-outage shape, not a total failure.
 * - **error** (Req 6.6/6.7): every one of the six sources takes its own
 *   failure/null branch — the same "unavailable" presentation `degraded`
 *   uses for its subset, but applied to all six sources at once.
 */
export function buildPreviewFixture(
  state: Exclude<PreviewState, 'loading'>,
  role: DashboardRole,
): DashboardFixtureData {
  switch (state) {
    case 'filled':
      return buildFilledFixture(role);

    case 'no-approvals':
      return { ...buildFilledFixture(role), approvals: [] };

    case 'degraded':
      return {
        ...buildFilledFixture(role),
        institutions: null,
        students: null,
        staff: null,
      };

    case 'error':
      return {
        institutions: null,
        students: null,
        staff: null,
        periods: null,
        approvals: null,
        roleDashboardResult: { dashboard: null, source: 'scaffold', status: 503 },
      };

    default: {
      // Exhaustiveness guard: TypeScript rejects this file at compile time
      // if `PreviewState` ever grows a new non-'loading' member that isn't
      // handled above.
      const unhandled: never = state;
      throw new Error(`Unhandled preview state: ${String(unhandled)}`);
    }
  }
}

/**
 * Returns a `Promise` that intentionally never resolves or rejects, for the
 * "Loading" preview state (Req 6.6): unlike the other four states, "Loading"
 * has no data shape to fabricate — the requirement is that the dashboard's
 * existing loading/skeleton presentation (`apps/web/src/app/(dashboard)/loading.tsx`)
 * stays showing for as long as the preview state remains set to `'loading'`,
 * rather than resolving to any final data state on its own.
 *
 * This helper only manufactures that never-settling promise. It is NOT
 * wired into `page.tsx`'s `Promise.all` here — substituting it in place of
 * the real six-source fetch when a `'loading'` override is active is Task
 * 8.2's responsibility, not this one's.
 *
 * Every call returns a new, independent promise (no shared/memoized state),
 * so callers substituting it per-source don't need to worry about one
 * caller's promise being observed or raced against by another.
 */
export function createNeverResolvingDashboardFetch<T>(): Promise<T> {
  return new Promise<T>(() => {
    // Intentionally empty: never calling `resolve` or `reject` is the point.
  });
}
