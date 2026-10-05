/**
 * Section roster + publish detail — Academics redesign (WS2).
 *
 * Route: /institutions/[id]/schedule/[sectionId]
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Card, CardContent } from '@proctira/ui/components';

import {
  SectionBulkEnrollForm,
  SectionEnrollForm,
  SectionPublishControls,
  WithdrawStudentButton,
} from '@/components/timetable/section-roster-controls';
import { formatCodeNameLabel, formatPersonLabel, resolveEntityLabel } from '@/lib/entity-label';
import { dayLabel, formatPeriodWhen } from '@/lib/timetable/conflict-label';
import { getStaff, listStaff } from '@/lib/api/staff';
import { listStudents } from '@/lib/api/students';
import { getSection, listPeriods, listRooms, listBellSchedules } from '@/lib/api/timetable';
import { LOOKUP_CONCURRENCY, mapWithConcurrency } from '@/lib/map-with-concurrency';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string; sectionId: string }>;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export default async function SectionRosterPage(props: PageProps) {
  const params = await props.params;
  const institutionId = params.id;
  const sectionResult = await getSection(params.sectionId);

  if (!sectionResult.ok) {
    return (
      <div className="space-y-4">
        <Link
          href={`/institutions/${institutionId}/schedule`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Master schedule
        </Link>
        <Card>
          <CardContent className="space-y-2 p-6">
            <p className="text-sm font-semibold">Section unavailable</p>
            <p className="text-sm text-muted-foreground" role="alert">
              {sectionResult.error}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const section = sectionResult.data;
  // PRC-H022: the route institution is an authorization boundary, not display
  // context — a section owned by another institution must not render here.
  if (section.institutionId !== institutionId) notFound();
  const enrollments = section.enrollments ?? [];
  const meetings = section.meetings ?? [];
  const active = enrollments.filter((e) => e.status === 'ENROLLED');

  const [studentsResult, staffResult, roomsResult, schedulesResult] = await Promise.all([
    listStudents({ pageSize: 100 }),
    listStaff({ pageSize: 100 }).catch(() => ({
      data: [],
      meta: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 },
    })),
    listRooms({ institutionId }),
    listBellSchedules({ institutionId }),
  ]);

  const studentName = new Map<string, string>();
  const studentAdmission = new Map<string, string>();
  const rememberStudent = (student: {
    id: string;
    firstName: string;
    lastName: string;
    nationalId?: string | null;
    customData?: Record<string, unknown>;
    admissionNumber?: string;
  }) => {
    const name = [student.firstName, student.lastName].filter(Boolean).join(' ').trim();
    if (name) studentName.set(student.id, name);
    const fromCustom = student.customData?.admissionNo;
    const admission =
      (typeof fromCustom === 'string' && fromCustom) ||
      student.admissionNumber ||
      // PRC-M156: never fall back to the national ID for a display code.
      '';
    if (admission) studentAdmission.set(student.id, admission);
  };
  const studentOptions = (studentsResult.data ?? []).map((s) => {
    rememberStudent(s);
    const admission = studentAdmission.get(s.id) ?? '';
    return {
      id: s.id,
      label: formatPersonLabel(s.firstName, s.lastName, admission || null),
      searchText: `${s.firstName} ${s.lastName} ${admission}`,
    };
  });
  const studentLabel = new Map(studentOptions.map((s) => [s.id, s.label]));
  // PRC-M097: resolve only the ids the bounded list did not return, deduped and
  // in parallel (capped) instead of one sequential round-trip per enrollment.
  const missingStudentIds = [
    ...new Set(enrollments.map((e) => e.studentId).filter((id) => !studentLabel.has(id))),
  ];
  // One batch request per 100 missing ids (GET /students?ids=...) instead of one per row.
  const idChunks: string[][] = [];
  for (let i = 0; i < missingStudentIds.length; i += 100) {
    idChunks.push(missingStudentIds.slice(i, i + 100));
  }
  const missingStudents = (
    await mapWithConcurrency(idChunks, LOOKUP_CONCURRENCY, (ids) =>
      listStudents({ ids, pageSize: 100 }),
    )
  ).flatMap((batch) => batch.data);
  for (const student of missingStudents) {
    if (!student) continue;
    rememberStudent(student);
    const label = formatPersonLabel(
      student.firstName,
      student.lastName,
      studentAdmission.get(student.id) ?? student.nationalId,
    );
    studentLabel.set(student.id, label);
    studentOptions.push({
      id: student.id,
      label,
      searchText: `${student.firstName} ${student.lastName} ${student.nationalId ?? ''}`,
    });
  }
  const staffLabel = new Map(
    (staffResult.data ?? []).map((s) => [s.id, formatPersonLabel(s.firstName, s.lastName)]),
  );
  const missingStaffIds = [
    ...new Set(
      meetings
        .map((m) => m.staffId)
        .filter((id): id is string => typeof id === 'string' && id !== '' && !staffLabel.has(id)),
    ),
  ];
  const missingStaff = await mapWithConcurrency(missingStaffIds, LOOKUP_CONCURRENCY, (id) =>
    getStaff(id).catch(() => null),
  );
  for (const person of missingStaff) {
    if (person) staffLabel.set(person.id, formatPersonLabel(person.firstName, person.lastName));
  }
  const roomLabel = new Map(
    (roomsResult.ok ? roomsResult.data : []).map((r) => [
      r.id,
      formatCodeNameLabel(r.code, r.name),
    ]),
  );

  const periodLabel = new Map<string, string>();
  const bellSchedules = schedulesResult.ok ? schedulesResult.data : [];
  const periodsBySchedule = await mapWithConcurrency(
    bellSchedules,
    LOOKUP_CONCURRENCY,
    (schedule) => listPeriods(schedule.id),
  );
  bellSchedules.forEach((schedule, index) => {
    const periods = periodsBySchedule[index];
    if (!periods?.ok) return;
    for (const p of periods.data) {
      periodLabel.set(
        p.id,
        `${schedule.name} · ${formatPeriodWhen(p.name, p.startTime, p.endTime)}`,
      );
    }
  });
  return (
    <div className="space-y-4" data-testid="institution-schedule-section">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/institutions/${institutionId}/schedule`}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            ← Master schedule
          </Link>
          <h2 className="mt-2 text-lg font-bold tracking-tight text-foreground">{section.name}</h2>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{section.code}</span>
            {' · '}
            <span
              className={
                section.status === 'PUBLISHED'
                  ? 'inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700'
                  : 'inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800'
              }
            >
              {section.status === 'PUBLISHED'
                ? 'Published'
                : section.status === 'DRAFT'
                  ? 'Draft'
                  : section.status}
            </span>
            {section.publishedAt
              ? ` · published ${new Date(section.publishedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
              : ''}
          </p>
        </div>
        <SectionPublishControls
          institutionId={institutionId}
          sectionId={section.id}
          status={section.status}
        />
      </div>

      <Card>
        <CardContent className="space-y-3 p-6">
          <div>
            <h3 className="text-base font-semibold">Meetings</h3>
            <p className="text-sm text-muted-foreground">
              {meetings.length} weekly {meetings.length === 1 ? 'meeting' : 'meetings'}
            </p>
          </div>
          {meetings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No meetings yet. Add them on the{' '}
              <Link
                href={`/institutions/${institutionId}/timetable`}
                className="underline underline-offset-4"
              >
                Timetable
              </Link>{' '}
              tab before publishing.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {meetings.map((m) => (
                <li key={m.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                  <b className="w-10">{dayLabel(m.dayOfWeek)}</b>
                  <span>{resolveEntityLabel(m.periodId, periodLabel, 'Period')}</span>
                  <span className="text-muted-foreground">
                    · {m.roomId ? resolveEntityLabel(m.roomId, roomLabel, 'Room') : 'no room'} ·{' '}
                    {resolveEntityLabel(m.staffId, staffLabel, 'Staff')}
                  </span>
                  <Link
                    href={`/institutions/${institutionId}/timetable?meeting=${m.id}#timetable-week-grid`}
                    className="font-semibold underline underline-offset-4"
                  >
                    Edit or remove
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-semibold">Roster</h3>
            <p className="text-xs text-muted-foreground">
              {active.length} / {section.capacity} enrolled
            </p>
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <SectionEnrollForm
              institutionId={institutionId}
              sectionId={section.id}
              studentOptions={studentOptions}
            />
            <SectionBulkEnrollForm
              institutionId={institutionId}
              sectionId={section.id}
              studentOptions={studentOptions}
            />
          </div>
          {enrollments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No enrollments yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-start text-muted-foreground">
                    <th className="py-2 font-medium">Student</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2 font-medium">Enrolled</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {enrollments.map((e) => (
                    <tr key={e.id} className="border-b border-border/60">
                      <td className="py-2 text-sm">
                        <div className="flex items-center gap-3">
                          <span
                            aria-hidden="true"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary"
                          >
                            {initials(studentName.get(e.studentId) ?? '')}
                          </span>
                          <span>
                            <span className="block font-semibold text-foreground">
                              {studentName.get(e.studentId) ??
                                resolveEntityLabel(e.studentId, studentLabel, 'Student')}
                            </span>
                            {studentAdmission.get(e.studentId) && (
                              <span className="block text-xs text-muted-foreground">
                                {studentAdmission.get(e.studentId)}
                              </span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 text-xs">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 font-semibold ${
                            e.status === 'ENROLLED'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-muted text-muted-foreground'
                          }`}
                          data-status={e.status}
                        >
                          {e.status === 'ENROLLED'
                            ? 'Enrolled'
                            : e.status === 'WITHDRAWN'
                              ? 'Withdrawn'
                              : e.status}
                        </span>
                      </td>
                      <td className="py-2 text-xs">
                        {e.enrolledAt
                          ? new Date(e.enrolledAt).toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })
                          : '—'}
                      </td>
                      <td className="py-2 text-end">
                        {e.status === 'ENROLLED' && (
                          <WithdrawStudentButton
                            institutionId={institutionId}
                            sectionId={section.id}
                            studentId={e.studentId}
                            studentName={
                              studentName.get(e.studentId) ??
                              resolveEntityLabel(e.studentId, studentLabel, 'Student')
                            }
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
