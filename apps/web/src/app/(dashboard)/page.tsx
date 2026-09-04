import Link from 'next/link';

import {
  ArrowRight,
  Briefcase,
  CalendarRange,
  CheckCircle2,
  ClipboardCheck,
  GraduationCap,
  Inbox,
  Plus,
  School,
  Upload,
} from 'lucide-react';

import { DocumentTitle } from '@/components/DocumentTitle';
import { listInstitutions } from '@/lib/api/institutions';
import { listStaff } from '@/lib/api/staff';
import { listStudents } from '@/lib/api/students';
import { listPendingApprovals, type WorkflowApproval } from '@/lib/api/workflows';
import { listAcademicPeriods } from '@/lib/institutions/api';
import type { AcademicPeriod } from '@/lib/institutions/types';

export const dynamic = 'force-dynamic';

/**
 * Dashboard home page (Server Component, Design System v2.0).
 *
 * Surfaces live tenant-level aggregates (institutions, students, staff,
 * active academic period) with graceful degradation when an upstream
 * service is unreachable, plus quick actions into the most common
 * day-one workflows.
 */
export default async function DashboardPage() {
  const [institutions, students, staff, periods, approvals] = await Promise.all([
    listInstitutions({ pageSize: 200 }).catch(() => null),
    listStudents({ pageSize: 1 }).catch(() => null),
    listStaff({ pageSize: 1 }).catch(() => null),
    listAcademicPeriods().catch(() => null as AcademicPeriod[] | null),
    listPendingApprovals().catch(() => null as WorkflowApproval[] | null),
  ]);

  const activePeriod = periods?.find((p) => p.status === 'active') ?? null;
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <section aria-labelledby="dashboard-heading" className="space-y-6">
      <DocumentTitle pageTitle="Dashboard" />

      <div>
        <h1
          id="dashboard-heading"
          className="text-3xl font-extrabold tracking-tight text-foreground"
        >
          {greeting}
        </h1>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          {today}
          {activePeriod ? ` · ${activePeriod.name}` : ''}
          {institutions ? ` · ${institutions.length} institutions` : ''}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Institutions"
          value={institutions ? formatCount(institutions.length) : null}
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
          <p className="text-xs text-[hsl(var(--muted-foreground))]">No approvals waiting on you.</p>
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {top.map((a) => (
            <li key={a.id}>
              <Link
                href="/workflows/approvals"
                className="block rounded-lg border border-[hsl(var(--border))] px-3 py-2 transition-colors hover:bg-[hsl(var(--muted))]"
              >
                <p className="truncate text-sm font-medium text-foreground">{a.definitionName}</p>
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
}: {
  label: string;
  value: string | null;
  icon: React.ReactNode;
  iconClass: string;
  href: string;
  small?: boolean;
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
        <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">
          Currently unavailable
        </p>
      ) : (
        <p
          className={`mt-2 font-bold tracking-tight ${
            small ? 'text-lg' : 'text-3xl'
          }`}
        >
          {value}
        </p>
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
