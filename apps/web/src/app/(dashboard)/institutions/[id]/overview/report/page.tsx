/**
 * Printable school report for one institution. Uses the same tenant-scoped
 * overview aggregates as the overview tab — no sample numbers.
 */
import Link from 'next/link';

import { getInstitution, getInstitutionOverview } from '@/lib/institutions/api';
import { PrintReportButton } from '@/components/institutions/print-report-button';

interface ReportPageProps {
  params: Promise<{ id: string }>;
}

export default async function InstitutionSchoolReportPage(props: ReportPageProps) {
  const params = await props.params;
  const institution = await getInstitution(params.id).catch(() => null);
  const snapshot = institution
    ? await getInstitutionOverview(institution.id).catch(() => null)
    : null;

  if (!institution || !snapshot) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Institution details are currently unavailable.
      </p>
    );
  }

  return (
    <article className="space-y-6" data-testid="school-report">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <Link
            href={`/institutions/${institution.id}/overview`}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            ← Overview
          </Link>
          <h2 className="mt-2 text-lg font-bold tracking-tight">School report</h2>
          <p className="text-sm text-muted-foreground">{institution.name}</p>
        </div>
        <PrintReportButton />
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Students</dt>
          <dd className="text-2xl font-bold tabular-nums">
            {snapshot.studentsAvailable && snapshot.students !== null
              ? snapshot.students.toLocaleString('en-IN')
              : 'Currently unavailable'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Staff</dt>
          <dd className="text-2xl font-bold tabular-nums">
            {snapshot.staffAvailable && snapshot.staff !== null
              ? snapshot.staff.toLocaleString('en-IN')
              : 'Currently unavailable'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Attendance (last 30 days)</dt>
          <dd className="text-2xl font-bold tabular-nums">
            {snapshot.attendanceAvailable && snapshot.attendancePercent !== null
              ? `${snapshot.attendancePercent}%`
              : 'Currently unavailable'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Classrooms</dt>
          <dd className="text-2xl font-bold tabular-nums">
            {snapshot.classroomsAvailable && snapshot.classrooms !== null
              ? snapshot.classrooms.toLocaleString('en-IN')
              : 'Currently unavailable'}
          </dd>
        </div>
      </dl>
      <section>
        <h3 className="text-base font-semibold">Enrollment by grade</h3>
        {snapshot.enrollmentByGrade.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Enrollment data is currently unavailable for this institution.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {snapshot.enrollmentByGrade.map((row) => (
              <li key={row.gradeId} className="flex justify-between gap-4">
                <span>{row.name}</span>
                <span className="tabular-nums font-semibold">
                  {row.count.toLocaleString('en-IN')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
