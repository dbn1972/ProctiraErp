import Link from 'next/link';

import {
  ArrowRight,
  Briefcase,
  CalendarRange,
  CheckCircle2,
  ClipboardCheck,
  GraduationCap,
  Inbox,
  LayoutDashboard,
  Plus,
  School,
  Upload,
} from 'lucide-react';

import { Badge } from '@proctira/ui/components';

import { DocumentTitle } from '@/components/DocumentTitle';
import { RoleDashboardPanel } from '@/app/(dashboard)/reports/_components/role-dashboard-panel';
import { PreviewStateBanner } from '@/components/dashboard/PreviewStateBanner';
import { PreviewStateSwitcher } from '@/components/dashboard/PreviewStateSwitcher';
import { ScaffoldModeBanner } from '@/components/insights/ScaffoldModeBanner';
import { listInstitutionsPage } from '@/lib/api/institutions';
import { getRoleDashboard, type DashboardRole } from '@/lib/api/reports';
import { listStaff } from '@/lib/api/staff';
import { listStudents } from '@/lib/api/students';
import { listPendingApprovals, type WorkflowApproval } from '@/lib/api/workflows';
import { getSession } from '@/lib/auth/server';
import {
  buildPreviewFixture,
  createNeverResolvingDashboardFetch,
  type DashboardFixtureData,
} from '@/lib/dashboard/previewStateFixtures';
import { hasDashboardPreviewPermission } from '@/lib/dashboard/previewStatePermission';
import { dashboardRoleLabel, detectDashboardRole } from '@/lib/dashboard/role-detection';
import { resolvePreviewOverride, type PreviewOverride } from '@/lib/dashboard/resolvePreviewOverride';
import { listAcademicPeriods } from '@/lib/institutions/api';
import type { AcademicPeriod } from '@/lib/institutions/types';

export const dynamic = 'force-dynamic';

/**
 * The six real dashboard data sources `DashboardPage` fetches, in call
 * order. Defined via indexed access into `DashboardFixtureData`
 * (`@/lib/dashboard/previewStateFixtures`) rather than redeclared inline —
 * that module documents its fields as the minimal subset of the real
 * gateway-client return shapes this page actually reads, so tying this
 * tuple to it keeps the real and fixture paths structurally bound to one
 * source of truth instead of two definitions that could drift apart.
 */
type DashboardSources = readonly [
  institutions: DashboardFixtureData['institutions'],
  students: DashboardFixtureData['students'],
  staff: DashboardFixtureData['staff'],
  periods: DashboardFixtureData['periods'],
  approvals: DashboardFixtureData['approvals'],
  roleDashboardResult: DashboardFixtureData['roleDashboardResult'],
];

/**
 * Resolves the six dashboard data sources, substituting fixture (or
 * never-resolving) data in place of the real gateway calls when a preview
 * override is active (Task 8.2, Requirement 6).
 *
 * - `previewOverride === null` — the path for every user who has never
 *   activated the preview switcher, and the only path for anyone lacking
 *   the `dashboard-preview:manage` permission (`resolvePreviewOverride()`
 *   already fails closed to `null` for both cases). Runs the exact same six
 *   real gateway calls, in the same order, with the same
 *   `.catch(() => ...)` degradation this page always used — this branch is
 *   unchanged by this task (Req 6.1's "real fetch path completely
 *   unaffected").
 * - `previewOverride.state === 'loading'` (Req 6.6): every slot becomes a
 *   promise that never resolves. None of the real gateway functions are
 *   called. The `Promise.all` awaiting this therefore never settles, which
 *   — because `apps/web/src/app/(dashboard)/loading.tsx` sits alongside
 *   `page.tsx` in this route segment — is exactly what keeps the App
 *   Router's automatic per-segment Suspense fallback (`RouteLoadingPanel`)
 *   showing indefinitely: Next.js wraps `page.tsx` (this async Server
 *   Component) in a `<Suspense fallback={<DashboardLoading/>}>` boundary
 *   and only swaps the fallback out once the wrapped component's render
 *   promise resolves (confirmed against Next.js's `loading.js` docs) —
 *   which, here, it never does while `'loading'` remains active. That
 *   boundary does NOT wrap `layout.tsx`, so the surrounding chrome
 *   (sidebar/header, resolved in `layout.tsx`) still renders normally;
 *   only this page's own content area hangs.
 * - Any other state (`'filled' | 'no-approvals' | 'degraded' | 'error'`,
 *   Req 6.3/6.4/6.5/6.7): calls `buildPreviewFixture()` exactly once and
 *   returns its six fields in place of the real calls. The real gateway
 *   functions are NOT called in this branch either — Requirement 6
 *   AC1/AC8/AC11 require this page to be fully isolated from the real
 *   tenant's data while an override is active, not merely to display
 *   different data, so an incidental real call whose result would just be
 *   discarded is avoided entirely rather than made and ignored.
 */
async function resolveDashboardSources(
  role: DashboardRole,
  previewOverride: PreviewOverride | null,
): Promise<DashboardSources> {
  if (previewOverride === null) {
    return Promise.all([
      listInstitutionsPage({ pageSize: 1 }).catch(() => null),
      listStudents({ pageSize: 1 }).catch(() => null),
      listStaff({ pageSize: 1 }).catch(() => null),
      listAcademicPeriods().catch(() => null as AcademicPeriod[] | null),
      listPendingApprovals().catch(() => null as WorkflowApproval[] | null),
      getRoleDashboard(role).catch(() => ({
        dashboard: null,
        source: 'scaffold' as const,
        status: 503,
      })),
    ]);
  }

  if (previewOverride.state === 'loading') {
    return Promise.all([
      createNeverResolvingDashboardFetch<DashboardFixtureData['institutions']>(),
      createNeverResolvingDashboardFetch<DashboardFixtureData['students']>(),
      createNeverResolvingDashboardFetch<DashboardFixtureData['staff']>(),
      createNeverResolvingDashboardFetch<DashboardFixtureData['periods']>(),
      createNeverResolvingDashboardFetch<DashboardFixtureData['approvals']>(),
      createNeverResolvingDashboardFetch<DashboardFixtureData['roleDashboardResult']>(),
    ]);
  }

  const fixture = buildPreviewFixture(previewOverride.state, role);
  return [
    fixture.institutions,
    fixture.students,
    fixture.staff,
    fixture.periods,
    fixture.approvals,
    fixture.roleDashboardResult,
  ];
}

/**
 * Dashboard home page (Server Component, Design System v2.0).
 *
 * Surfaces live tenant-level aggregates (institutions, students, staff,
 * active academic period) with graceful degradation when an upstream
 * service is unreachable, plus quick actions into the most common
 * day-one workflows.
 */
export default async function DashboardPage() {
  const session = await getSession();
  const role = detectDashboardRole(session?.user.roles);

  // Task 8.2 (Req 6.1, 6.3-6.8, 6.11): resolved before the six-source fetch
  // below so an active, authorized, unexpired preview override can
  // substitute fixture/never-resolving data for the six real gateway calls.
  // `resolvePreviewOverride()` re-checks the `dashboard-preview:manage`
  // permission and cookie expiry fresh on every call and fails closed to
  // `null` on any error — so this is a no-op read for every user who has
  // never touched the preview switcher, or who lacks the permission.
  const previewOverride = await resolvePreviewOverride();

  // Task 10.2 (Req 6.1, 6.12): server-derived visibility gate for
  // `<PreviewStateSwitcher>`, computed from this same request's `session`
  // rather than the client-side `AuthUser.permissions` array (see that
  // component's own doc comment for why that array can't be used).
  // `hasDashboardPreviewPermission()` (`@/lib/dashboard/previewStatePermission`)
  // expects a non-null `ServerSession`; `session` is `null` for a
  // logged-out/unauthenticated request (mirroring `detectDashboardRole`'s
  // own `session?.user.roles` optional-chaining just above), so an absent
  // session simply means "cannot manage preview" rather than a call worth
  // making at all — there's no meaningful permission check to run against
  // no session.
  const canManagePreview = session ? hasDashboardPreviewPermission(session) : false;

  const [institutions, students, staff, periods, approvals, roleDashboardResult] =
    await resolveDashboardSources(role, previewOverride);

  const activePeriod = periods?.find((p) => p.status === 'active') ?? null;

  // Task 13.2 (Req 3.2): "N new this term" on the Students card — a count of
  // students created within the active academic period's date bounds,
  // computed server-side via `createdAfter`/`createdBefore` (a narrow filter
  // on the existing `GET /students` endpoint) rather than fetching the full
  // roster to count client-side. Runs after the main `Promise.all` because it
  // depends on `activePeriod`, which itself comes out of that batch. Omitted
  // (not an error state) when there is no active period, or the count fetch
  // itself fails, per the same `.catch(() => null)` degradation used above.
  //
  // Task 8.2: also omitted whenever a preview override is active
  // (`previewOverride !== null`), rather than letting this real
  // `listStudents({ createdAfter, createdBefore })` call run against
  // `activePeriod`. This call is a seventh real gateway request that isn't
  // one of the six sources `resolveDashboardSources` isolates above, but
  // Req 6 AC1/AC8/AC11's isolation requirement is not limited to those six
  // — it requires this page to make no real tenant-data call at all while a
  // preview state is forcing a fabricated view. Without this guard, the
  // `'filled'`/`'no-approvals'`/`'degraded'` fixtures (which all populate
  // `periods` with an active period) would cause a real call to fire here
  // even though the six main sources are fully isolated, and — worse —
  // under `'degraded'` the Students KPI card itself is forced to "Currently
  // unavailable" while this subtext would still silently show a real
  // number underneath it. `previewStateFixtures.ts` deliberately has no
  // fixture for this field (it documents exactly six sources, and this
  // isn't one of them), so rather than inventing an ad hoc fixture number
  // here, the subtext is simply omitted under every active override,
  // consistent with the existing "omit rather than fabricate" pattern used
  // elsewhere in this spec (Req 3 AC5). Under `'loading'`, this line is
  // unreachable anyway: `resolveDashboardSources` never settles, so the
  // render never gets past the `await` above.
  const newStudentsCount =
    previewOverride === null && activePeriod
      ? await listStudents({
          pageSize: 1,
          createdAfter: activePeriod.startDate,
          createdBefore: activePeriod.endDate,
        })
          .then((result) => result.meta?.totalItems ?? null)
          .catch(() => null)
      : null;

  const { dashboard: roleDashboard, source: roleDashboardSource } = roleDashboardResult;
  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <section aria-labelledby="dashboard-heading" className="space-y-6">
      <DocumentTitle pageTitle="Dashboard" />

      {/*
       * Task 10.2 (Req 6.10): the fabricated-state banner, rendered at the
       * top of the dashboard page per design.md's "Visible indicator"
       * paragraph, directly above `<PreviewStateSwitcher>` — the two are
       * one feature surface (banner tells you you're in preview mode;
       * switcher lets you change/clear it from the same place). Both are
       * automatically session-scoped with no extra code here: see
       * `PreviewStateBanner`'s own doc comment for why `previewOverride`
       * (and therefore `activeState`) can never reflect another session's
       * preview state (Req 6 AC8, AC11).
       */}
      <PreviewStateBanner activeState={previewOverride?.state ?? null} />
      <PreviewStateSwitcher canManagePreview={canManagePreview} />

      <div>
        <h1
          id="dashboard-heading"
          className="text-3xl font-extrabold tracking-tight text-foreground"
        >
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          {today}
          {activePeriod ? ` · ${activePeriod.name}` : ''}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Institutions"
          value={institutions ? formatCount(institutions.totalItems) : null}
          icon={<School className="h-4 w-4" aria-hidden="true" />}
          iconClass="bg-[var(--color-primary-50)] text-[var(--color-primary-600)]"
          href="/institutions"
        />
        <KpiCard
          label="Students"
          value={students ? formatCount(students.meta?.totalItems ?? 0) : null}
          icon={<GraduationCap className="h-4 w-4" aria-hidden="true" />}
          iconClass="bg-[var(--color-accent-50)] text-[var(--color-accent-600)]"
          href="/students"
          subtext={newStudentsCount !== null ? `${newStudentsCount} new this term` : null}
        />
        <KpiCard
          label="Staff"
          value={staff ? formatCount(staff.meta?.totalItems ?? 0) : null}
          icon={<Briefcase className="h-4 w-4" aria-hidden="true" />}
          iconClass="bg-violet-50 text-violet-600 dark:bg-violet-500/15"
          href="/staff"
        />
        <KpiCard
          label="Academic period"
          value={activePeriod ? activePeriod.name : null}
          icon={<CalendarRange className="h-4 w-4" aria-hidden="true" />}
          iconClass="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15"
          href="/academic-periods"
          small
        />
      </div>

      {roleDashboard ? (
        <div className="rounded-xl border bg-[hsl(var(--card))] p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <LayoutDashboard className="h-4 w-4 text-[hsl(var(--primary))]" aria-hidden="true" />
              {dashboardRoleLabel(role)} snapshot
            </h2>
            <Link
              href={`/reports/dashboard?role=${role}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--primary))] hover:underline"
              data-testid="home-role-dashboard-link"
            >
              Full dashboard
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
          <RoleDashboardPanel dashboard={roleDashboard} />
        </div>
      ) : (
        <ScaffoldModeBanner
          source={roleDashboardSource}
          surface={`${dashboardRoleLabel(role)} dashboard`}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="rounded-xl border bg-[hsl(var(--card))] p-5 shadow-sm">
          <h2 className="text-base font-semibold">Quick actions</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <QuickAction href="/students/new" label="Add student">
              <Plus className="h-4 w-4" aria-hidden="true" />
            </QuickAction>
            <QuickAction href="/attendance" label="Mark attendance">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            </QuickAction>
            <QuickAction href="/students/import" label="Bulk import students">
              <Upload className="h-4 w-4" aria-hidden="true" />
            </QuickAction>
            <QuickAction href="/assessments/results" label="Enter results">
              <GraduationCap className="h-4 w-4" aria-hidden="true" />
            </QuickAction>
          </div>
        </div>

        <ApprovalsPanel approvals={approvals} />
      </div>
    </section>
  );
}

function ApprovalsPanel({ approvals }: { approvals: WorkflowApproval[] | null }) {
  const top = approvals?.slice(0, 5) ?? [];
  return (
    <div className="rounded-xl border bg-[hsl(var(--card))] p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <ClipboardCheck className="h-4 w-4 text-[hsl(var(--primary))]" aria-hidden="true" />
          Pending approvals
          {approvals && approvals.length > 0 && (
            <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
              {approvals.length}
            </span>
          )}
        </h2>
        <Link
          href="/workflows/approvals"
          className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--primary))] hover:underline"
        >
          View all
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>

      {approvals === null ? (
        <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">Currently unavailable</p>
      ) : top.length === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-1 py-6 text-center">
          <Inbox className="h-8 w-8 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
          <p className="text-sm font-medium">All caught up</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            No approvals waiting on you.
          </p>
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {top.map((a) => (
            <li key={a.id}>
              <Link
                href="/workflows/approvals"
                className="block rounded-lg border border-[hsl(var(--border))] px-3 py-2 transition-colors hover:bg-[hsl(var(--muted))]"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-foreground">
                    {a.definitionName}
                  </p>
                  <ApprovalCategoryBadge category={a.category} />
                </div>
                <p className="truncate text-[11px] text-[hsl(var(--muted-foreground))]">
                  {a.stepName || '—'} · {a.subjectType}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Category/kind indicator for a pending approval (Requirement 5 AC1, AC4).
 *
 * `category` is sourced from the workflow instance's real taxonomy field
 * (`WorkflowApproval.category`, Task 4.1) — never inferred from
 * `definitionName`/`subjectType` string matching. An approval predating the
 * taxonomy, or whose workflow definition isn't mapped to a category, falls
 * back to a defined "Uncategorized" presentation rather than being omitted.
 */
function ApprovalCategoryBadge({ category }: { category?: string }) {
  if (category === 'transfer') {
    return (
      <Badge variant="secondary" className="shrink-0">
        Transfer
      </Badge>
    );
  }
  if (category === 'leave') {
    return (
      <Badge variant="outline" className="shrink-0">
        Leave
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="shrink-0">
      Uncategorized
    </Badge>
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

function KpiCard({
  label,
  value,
  icon,
  iconClass,
  href,
  small = false,
  subtext = null,
}: {
  label: string;
  value: string | null;
  icon: React.ReactNode;
  iconClass: string;
  href: string;
  small?: boolean;
  subtext?: string | null;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border bg-[hsl(var(--card))] p-5 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconClass}`}
          aria-hidden="true"
        >
          {icon}
        </span>
        <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          {label}
        </p>
      </div>
      {value === null ? (
        <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">Currently unavailable</p>
      ) : (
        <>
          <p className={`mt-2 font-bold tracking-tight ${small ? 'text-lg' : 'text-3xl'}`}>
            {value}
          </p>
          {subtext ? (
            <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{subtext}</p>
          ) : null}
        </>
      )}
    </Link>
  );
}

function QuickAction({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 py-2 text-sm font-semibold shadow-sm transition-colors hover:bg-[hsl(var(--muted))]"
    >
      {children}
      {label}
    </Link>
  );
}
