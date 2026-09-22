/**
 * /attendance/ops — regularisation and student leave (G-919).
 */
import Link from 'next/link';

import { ArrowLeft } from 'lucide-react';

import { Button, Card, CardContent } from '@proctira/ui/components';
import { listLeaveRequests, listRegularisations } from '@/lib/api/attendance';
import { listInstitutions } from '@/lib/api/institutions';
import { listStudents } from '@/lib/api/students';
import { formatCodeNameLabel, formatPersonLabel, type EntityLabelOption } from '@/lib/entity-label';
import { listAcademicPeriods, listClassesByInstitution } from '@/lib/institutions/api';

import { AttendanceOpsForms } from '../_components/attendance-ops-forms';
import { MAX_API_PAGE_SIZE } from '@/lib/api/pagination';

export const dynamic = 'force-dynamic';

async function loadAttendanceOpsLookups(): Promise<{
  studentOptions: EntityLabelOption[];
  /** True when the student picker holds only the first page of a larger set. */
  studentOptionsTruncated: boolean;
  studentTotal: number;
  institutionOptions: EntityLabelOption[];
  classOptions: EntityLabelOption[];
  periodOptions: EntityLabelOption[];
}> {
  const [studentsResult, institutions] = await Promise.all([
    listStudents({ pageSize: MAX_API_PAGE_SIZE }),
    listInstitutions({ pageSize: MAX_API_PAGE_SIZE }),
  ]);

  // KNOWN LIMITATION, made explicit rather than silent.
  //
  // This is a client-side searchable picker (`searchText`) over what it assumes is
  // the full student set, but the gateway caps a page at MAX_API_PAGE_SIZE. On a
  // tenant with 3,000 students only the first page is selectable.
  //
  // Previously this asked for 200, which the gateway rejected outright, so the picker
  // was empty — obviously broken. Clamping makes it work for small tenants but
  // silently partial for large ones, which is arguably worse. The label below tells
  // the user, so a staff member who cannot find a student knows why.
  //
  // The real fix is a server-side student search endpoint for this picker; until then
  // do not treat these options as exhaustive.
  const studentOptions: EntityLabelOption[] = (studentsResult.data ?? []).map((student) => ({
    id: student.id,
    label: formatPersonLabel(student.firstName, student.lastName, student.nationalId),
    searchText: `${student.firstName} ${student.lastName} ${student.nationalId ?? ''}`,
  }));
  const studentTotal = studentsResult.meta?.totalItems ?? studentOptions.length;
  const studentOptionsTruncated = studentTotal > studentOptions.length;

  const institutionOptions: EntityLabelOption[] = institutions.map((institution) => ({
    id: institution.id,
    label: formatCodeNameLabel(institution.code, institution.name),
    searchText: institution.name,
  }));

  const [periods, classLists] = await Promise.all([
    listAcademicPeriods().catch(() => []),
    Promise.all(
      institutions.map(async (institution) => {
        const classes = await listClassesByInstitution(institution.id).catch(() => []);
        return classes.map((section) => ({
          id: section.id,
          label: `${formatCodeNameLabel(institution.code, institution.name)} · ${section.name}`,
          searchText: `${institution.name} ${section.name}`,
        }));
      }),
    ),
  ]);

  return {
    studentOptions,
    studentOptionsTruncated,
    studentTotal,
    institutionOptions,
    classOptions: classLists.flat(),
    periodOptions: periods.map((period) => ({
      id: period.id,
      label: period.name,
    })),
  };
}

export default async function AttendanceOpsPage() {
  const [regularisations, leaves, lookups] = await Promise.all([
    listRegularisations(),
    listLeaveRequests(),
    loadAttendanceOpsLookups(),
  ]);

  return (
    <section className="space-y-6" data-testid="attendance-ops-page" data-hydrated="true">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/attendance">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to attendance
        </Link>
      </Button>
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
          Regularisation and leave
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Request a status change on a past record or a student leave range. Approvers update the
          register with an audit trail. EARLY_DEPARTURE counts as present-partial (0.5) in
          percentages.
        </p>
      </div>
      {lookups.studentOptionsTruncated ? (
        <p
          role="status"
          className="rounded-md border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-3 py-2 text-sm text-[var(--color-warning-900)]"
        >
          Showing the first {lookups.studentOptions.length.toLocaleString()} of{' '}
          {lookups.studentTotal.toLocaleString()} students. If the student you need is not listed,
          search by class or period instead — this picker is limited to one page.
        </p>
      ) : null}
      <Card>
        <CardContent className="p-6">
          <AttendanceOpsForms
            regularisations={regularisations}
            leaves={leaves}
            studentOptions={lookups.studentOptions}
            institutionOptions={lookups.institutionOptions}
            classOptions={lookups.classOptions}
            periodOptions={lookups.periodOptions}
          />
        </CardContent>
      </Card>
    </section>
  );
}
