/**
 * TenantIdentityBlock — sidebar tenant/school identity (Requirement 1).
 *
 * Server Component. Reads the tenant's display name via
 * `getTenantSettings()` (`apps/web/src/lib/api/admin.server.ts`) and pairs
 * it with a student headcount supplied by the caller — the same data
 * already backing the Students KPI card on the dashboard home page
 * (`apps/web/src/app/(dashboard)/page.tsx`), so this component never runs
 * its own separate count query.
 *
 * Renders nothing (not a blank placeholder) when tenant settings are
 * unavailable, consistent with the existing `.catch(() => null)` →
 * "Currently unavailable" degradation pattern used elsewhere in the
 * dashboard chrome (Req 1 AC3).
 *
 * Deliberately out of scope: board/affiliation and branch/campus count.
 * Neither `TenantSettings` nor `Institution` has such a field today
 * (Req 1 AC4) — this block only ever renders `displayName` + headcount.
 *
 * This is the component definition only (Task 11.1). Mounting it inside
 * `apps/web/src/components/layout/sidebar.tsx` and wiring a real
 * `studentCount` value through from the page is Task 11.2.
 */
import { GraduationCap } from 'lucide-react';

import { getTenantSettings } from '@/lib/api/admin.server';

export interface TenantIdentityBlockProps {
  /**
   * Student headcount from the same source already backing the Students
   * KPI card (e.g. `listStudents({ pageSize: 1 })`'s `meta.totalItems`).
   * `null` when that source is unavailable — the headcount line is
   * omitted while the tenant name still renders on its own (Req 1 AC5).
   */
  studentCount: number | null;
}

export async function TenantIdentityBlock({ studentCount }: TenantIdentityBlockProps) {
  const { settings } = await getTenantSettings();
  if (!settings?.displayName) return null; // renders nothing, not a blank placeholder — Req 1 AC3

  return (
    <div className="border-t border-white/10 px-5 py-3" data-testid="tenant-identity-block">
      <p className="truncate text-sm font-semibold text-white" title={settings.displayName}>
        {settings.displayName}
      </p>
      {studentCount !== null && (
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
          <GraduationCap className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{formatStudentCount(studentCount)}</span>
        </p>
      )}
    </div>
  );
}

/** Matches the KPI card's `formatCount` (`en-IN` grouping) plus a unit label. */
function formatStudentCount(value: number): string {
  return `${new Intl.NumberFormat('en-IN').format(value)} student${value === 1 ? '' : 's'}`;
}
