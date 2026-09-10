/**
 * /staff/[id]/assignments/new — Create staff assignment — v2.0 redesign.
 *
 * v2.0 changes:
 * - text-3xl font-extrabold heading "New teaching assignment"
 * - Subtitle: timetable clash check + 24-period cap note
 * - "Back to profile" in page-head actions
 * - 2-col layout: main (AssignmentForm) + sidebar (Current workload + Section coverage)
 * - AssignmentForm kept 100% intact
 */
import Link from 'next/link';

import { AlertTriangle, ArrowLeft } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { cn } from '@/lib/utils';
import { listInstitutions } from '@/lib/api/institutions';
import { getStaff, listStaffAssignments } from '@/lib/api/staff';
import {
  listClassesByInstitution,
  listSubjects,
  type SubjectSummary,
} from '@/lib/institutions/api';
import type { ClassSection } from '@/lib/institutions/types';

import { AssignmentForm } from '../../../_components/assignment-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/* ──────────────────────────────────────── Current workload sidebar card ── */

function WorkloadCard({
  assignments,
  staffName,
}: {
  assignments: {
    id: string;
    classId: string;
    subjectId: string;
    status: string;
    allocationPercentage: number;
  }[];
  staffName: string;
}) {
  const active = assignments.filter((a) => a.status === 'ACTIVE');
  const totalPct = active.reduce((sum, a) => sum + a.allocationPercentage, 0);
  const nearCap = totalPct >= 90;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Current workload</CardTitle>
        <CardDescription className="text-xs">{staffName} · active assignments</CardDescription>
      </CardHeader>
      <CardContent className="pb-5 space-y-0">
        {active.length === 0 ? (
          <p className="text-xs text-muted-foreground pb-2">No active assignments yet.</p>
        ) : (
          <div className="space-y-1.5 pb-3">
            {active.map((a) => (
              <div key={a.id} className="flex items-center justify-between text-xs">
                <span className="truncate text-muted-foreground">
                  {a.classId.slice(0, 20)} — {a.subjectId.slice(0, 16)}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {a.allocationPercentage}%
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-border pt-1.5 text-xs font-semibold">
              <span className="text-muted-foreground">Total allocation</span>
              <span
                className={cn(
                  'tabular-nums',
                  nearCap ? 'text-amber-600 dark:text-amber-400' : 'text-foreground',
                )}
              >
                {totalPct}%
              </span>
            </div>
          </div>
        )}

        {/* Progress bar */}
        <div className="pb-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full',
                totalPct >= 100 ? 'bg-red-500' : nearCap ? 'bg-amber-500' : 'bg-primary',
              )}
              style={{ width: `${Math.min(100, totalPct).toFixed(1)}%` }}
              role="progressbar"
              aria-valuenow={totalPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Current workload allocation"
            />
          </div>
        </div>

        {nearCap && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-800 dark:bg-amber-950/30">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
            <div className="text-xs">
              <p className="font-semibold text-amber-800 dark:text-amber-300">
                Near allocation cap
              </p>
              <p className="text-amber-700 dark:text-amber-400">
                Adding this assignment will bring total close to 100%. Substitution duty cannot be
                auto-assigned beyond full capacity.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────────────── Section coverage sidebar card ── */

function SectionCoverageCard() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Section coverage</CardTitle>
        <CardDescription className="text-xs">
          Coverage gap for the selected class and subject
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-4">
        <p className="text-xs text-muted-foreground">
          Select a class and subject to see the current coverage status and whether a gap exists for
          this section.
        </p>
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────────────────────── Page ── */

export default async function NewAssignmentPage(props: PageProps) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const rawInstitutionId = searchParams?.institutionId;
  const institutionId = typeof rawInstitutionId === 'string' ? rawInstitutionId : '';

  const [staff, assignments, institutions, subjects, classes] = await Promise.all([
    getStaff(params.id),
    listStaffAssignments(params.id),
    listInstitutions({ pageSize: 200 }),
    listSubjects().catch(() => [] as SubjectSummary[]),
    institutionId
      ? listClassesByInstitution(institutionId).catch(() => [] as ClassSection[])
      : Promise.resolve<ClassSection[]>([]),
  ]);

  // Soft-render when the profile API is unavailable so client validation still works.
  const staffId = staff?.id ?? params.id;
  const fullName = staff ? `${staff.firstName} ${staff.lastName}` : 'this staff member';

  // listSubjects / listClasses may return `{ data: [] }` from some gateways — normalize.
  const subjectRows = Array.isArray(subjects)
    ? subjects
    : Array.isArray((subjects as { data?: SubjectSummary[] } | null)?.data)
      ? (subjects as { data: SubjectSummary[] }).data
      : [];
  const classRows = Array.isArray(classes)
    ? classes
    : Array.isArray((classes as { data?: ClassSection[] } | null)?.data)
      ? (classes as { data: ClassSection[] }).data
      : [];
  const institutionRows = Array.isArray(institutions) ? institutions : [];

  return (
    <section aria-labelledby="new-assignment-heading" className="space-y-6">
      {/* ── Page head ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="new-assignment-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            New teaching assignment
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Allocate a class, section, and subject to {fullName}. The timetable is checked for
            clashes and the allocation cap is enforced on save.
          </p>
        </div>
        <div className="shrink-0">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/staff/${staffId}`}>
              <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
              Back to profile
            </Link>
          </Button>
        </div>
      </div>

      {!staff && (
        <div
          className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
          role="status"
        >
          Staff profile could not be loaded. You can still complete the form; save requires a live
          staff record.
        </div>
      )}

      {/* ── 2-column layout ── */}
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        {/* ── Main: form ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Assignment details</CardTitle>
            <CardDescription>
              Staff member, school, class, subject, schedule, and effective dates.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AssignmentForm
              staffId={staffId}
              institutions={institutionRows.map((i) => ({ id: i.id, name: i.name }))}
              subjects={subjectRows.map((s) => ({ id: s.id, name: s.name, code: s.code }))}
              classes={classRows.map((c) => ({ id: c.id, name: c.name }))}
              defaultInstitutionId={institutionId}
            />
          </CardContent>
        </Card>

        {/* ── Sidebar ── */}
        <aside className="flex flex-col gap-5" aria-label="Assignment context sidebar">
          <WorkloadCard assignments={assignments} staffName={fullName} />
          <SectionCoverageCard />
        </aside>
      </div>
    </section>
  );
}
