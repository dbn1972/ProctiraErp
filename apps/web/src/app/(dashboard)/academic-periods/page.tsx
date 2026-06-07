/**
 * Academic period management page (Server Component).
 *
 * Lists every academic period for the active tenant and lets administrators
 * create, edit, and delete periods via the embedded manager component.
 *
 * Validates: Requirement 5.5 — academic period CRUD with status lifecycle.
 */
import { CalendarRange } from 'lucide-react';

import { AcademicPeriodsManager } from '@/components/institutions/academic-periods-manager';
import { ApiClientError, listAcademicPeriods } from '@/lib/institutions/api';
import type { AcademicPeriod } from '@/lib/institutions/types';

export default async function AcademicPeriodsPage() {
  const result = await loadAcademicPeriods();

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <CalendarRange className="h-6 w-6" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Academic periods</h1>
          <p className="text-sm text-muted-foreground">
            Manage academic years and terms used across enrollment,
            attendance, and assessment workflows.
          </p>
        </div>
      </header>

      <AcademicPeriodsManager
        periods={result.periods}
        loadError={result.error}
      />
    </div>
  );
}

async function loadAcademicPeriods(): Promise<{
  periods: AcademicPeriod[];
  error: string | null;
}> {
  try {
    const periods = await listAcademicPeriods();
    return {
      periods: [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate)),
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
