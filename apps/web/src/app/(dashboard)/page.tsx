import Link from 'next/link';

import {
  Briefcase,
  CalendarRange,
  CheckCircle2,
  GraduationCap,
  Plus,
  School,
  Upload,
} from 'lucide-react';

import { DocumentTitle } from '@/components/DocumentTitle';
import { listInstitutions } from '@/lib/api/institutions';
import { listStaff } from '@/lib/api/staff';
import { listStudents } from '@/lib/api/students';
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
  const [institutions, students, staff, periods] = await Promise.all([
    listInstitutions({ pageSize: 200 }).catch(() => null),
    listStudents({ pageSize: 1 }).catch(() => null),
    listStaff({ pageSize: 1 }).catch(() => null),
    listAcademicPeriods().catch(() => null as AcademicPeriod[] | null),
  ]);

  const activePeriod = periods?.find((p) => p.status === 'active') ?? null;
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
          className="text-2xl font-semibold tracking-tight"
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
    </section>
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
