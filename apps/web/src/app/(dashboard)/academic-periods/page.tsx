/**
 * Academic period management page (Server Component) — v2.0 redesign.
 *
 * Lists every academic period for the active tenant and lets administrators
 * create, edit, and delete periods via the embedded manager component.
 * A v2.0 hero head + active-period info banner sit above the manager.
 *
 * Validates: Requirement 5.5 — academic period CRUD with status lifecycle.
 */
import Link from 'next/link';
import { Bell, Download, Info } from 'lucide-react';

import { Button } from '@proctira/ui/components';
import { AcademicPeriodsManager } from '@/components/institutions/academic-periods-manager';
import { ApiClientError, listAcademicPeriods } from '@/lib/institutions/api';
import type { AcademicPeriod } from '@/lib/institutions/types';

function formatRange(start: string, end: string): string {
  const fmt = (d: string) => {
    const date = new Date(d);
    return Number.isNaN(date.getTime())
      ? d
      : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

export default async function AcademicPeriodsPage() {
  const result = await loadAcademicPeriods();
  const active = result.periods.find((p) => p.status === 'active');

  return (
    <section aria-labelledby="periods-heading" className="space-y-6">
      {/* ── Page head ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="periods-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Academic periods
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Academic years and terms drive enrollment, attendance, assessments, and promotions
            across all institutions.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {active && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/academic-periods/${active.id}/bell-schedules`}>
                <Bell className="me-1.5 h-4 w-4" aria-hidden="true" />
                Bell schedules
              </Link>
            </Button>
          )}
          <Button variant="outline" size="sm" disabled>
            <Download className="me-1.5 h-4 w-4" aria-hidden="true" />
            Export calendar
          </Button>
        </div>
      </div>

      {/* ── Active period banner ── */}
      {active && (
        <div className="flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm dark:border-sky-800 dark:bg-sky-950/30">
          <Info
            className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold text-sky-900 dark:text-sky-200">
              {active.name} is the active period
            </p>
            <p className="text-sky-800 dark:text-sky-300">
              New admissions, attendance registers, and assessment schedules are recorded against
              this period · {formatRange(active.startDate, active.endDate)}.
            </p>
          </div>
        </div>
      )}

      <AcademicPeriodsManager periods={result.periods} loadError={result.error} />
    </section>
  );
}

async function loadAcademicPeriods(): Promise<{
  periods: AcademicPeriod[];
  error: string | null;
}> {
  try {
    const periods = await listAcademicPeriods();
    return {
      periods: [...periods].sort((a, b) => b.startDate.localeCompare(a.startDate)),
      error: null,
    };
  } catch (error) {
    return {
      periods: [],
      error:
        error instanceof ApiClientError
          ? error.message
          : 'The academic period service is currently unavailable.',
    };
  }
}
