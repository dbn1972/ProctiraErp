/**
 * Institution master schedule — sections list/create + publish (WS2).
 *
 * Route: /institutions/[id]/schedule
 */
import Link from 'next/link';

import { Card, CardContent } from '@proctira/ui/components';

import { SectionCreateForm } from '@/components/timetable/section-create-form';
import { SectionPublishControls } from '@/components/timetable/section-roster-controls';
import { listAcademicPeriods } from '@/lib/institutions/api';
import { getStaff, listStaff } from '@/lib/api/staff';
import {
  listBellSchedules,
  listPeriods,
  listRooms,
  listScheduleConflicts,
  listSections,
} from '@/lib/api/timetable';
import { formatPersonLabel } from '@/lib/entity-label';
import {
  conflictReasonLabel,
  formatPeriodWhen,
  formatScheduleConflict,
} from '@/lib/timetable/conflict-label';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function InstitutionSchedulePage(props: PageProps) {
  const params = await props.params;
  const institutionId = params.id;

  let academicPeriodId = '';
  try {
    const periods = await listAcademicPeriods();
    academicPeriodId = periods.find((p) => p.status === 'active')?.id ?? periods[0]?.id ?? '';
  } catch {
    academicPeriodId = '';
  }

  const [sectionsResult, roomsResult, conflictsResult] = await Promise.all([
    listSections({
      institutionId,
      academicPeriodId: academicPeriodId || undefined,
    }),
    listRooms({ institutionId }),
    listScheduleConflicts({
      institutionId,
      academicPeriodId: academicPeriodId || undefined,
    }),
  ]);

  const apiError = !sectionsResult.ok
    ? sectionsResult.error
    : !roomsResult.ok
      ? roomsResult.error
      : null;

  const sections = sectionsResult.ok ? sectionsResult.data : [];
  const rooms = roomsResult.ok ? roomsResult.data : [];
  const conflicts = conflictsResult.ok ? conflictsResult.data : [];
  const roomOptions = rooms.map((r) => ({
    id: r.id,
    label: `${r.code} · ${r.name}`,
  }));
  const roomLabel = new Map(roomOptions.map((r) => [r.id, r.label]));
  const staffResult = await listStaff({ page: 1, pageSize: 100 }).catch(() => null);
  const staffLabel = new Map(
    (staffResult?.data ?? []).map((person) => [
      person.id,
      formatPersonLabel(person.firstName, person.lastName, person.position),
    ]),
  );
  const periodLabel = new Map<string, string>();
  const schedules = await listBellSchedules({ institutionId });
  for (const schedule of schedules.ok ? schedules.data : []) {
    const periods = await listPeriods(schedule.id);
    if (!periods.ok) continue;
    for (const period of periods.data) {
      periodLabel.set(period.id, formatPeriodWhen(period.name, period.startTime, period.endTime));
    }
  }
  const sectionLabel = new Map(sections.map((section) => [section.id, section.name]));
  for (const conflict of conflicts) {
    if (conflict.staffId && !staffLabel.has(conflict.staffId)) {
      const person = await getStaff(conflict.staffId).catch(() => null);
      if (person) {
        staffLabel.set(
          person.id,
          formatPersonLabel(person.firstName, person.lastName, person.position),
        );
      }
    }
  }

  return (
    <div className="space-y-4" data-testid="institution-schedule">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-foreground">Master schedule</h2>
        <p className="text-sm text-muted-foreground">
          Course sections, room assignment, rostering, and draft → published workflow. Room and
          teacher clashes are blocked.
        </p>
      </div>

      {apiError ? (
        <Card>
          <CardContent className="space-y-2 p-6">
            <p className="text-sm font-semibold">Schedule API unavailable</p>
            <p className="text-sm text-muted-foreground" role="alert">
              {apiError}
              {sectionsResult.ok === false &&
                sectionsResult.code === 'TIMETABLE_SCHEMA_MISSING' &&
                ' Schedule storage is not set up for this environment yet. Contact your administrator.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {conflicts.length > 0 && (
            <Card>
              <CardContent className="space-y-2 p-6" data-testid="schedule-conflicts">
                <h3 className="text-base font-semibold">Schedule conflicts ({conflicts.length})</h3>
                <p className="text-sm text-muted-foreground">
                  Conflict engine surface — resolve room/teacher/class double-books before publish.
                </p>
                <ul className="space-y-2 text-sm">
                  {conflicts.slice(0, 12).map((c, idx) => (
                    <li
                      key={`${c.againstMeetingId}-${c.reason}-${idx}`}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                        {conflictReasonLabel(c.reason)}
                      </span>
                      <span>
                        {formatScheduleConflict(c, {
                          staff: staffLabel,
                          room: roomLabel,
                          period: periodLabel,
                          section: sectionLabel,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="space-y-4 p-6">
              <h3 className="text-base font-semibold">Create section</h3>
              <SectionCreateForm
                institutionId={institutionId}
                academicPeriodId={academicPeriodId}
                roomOptions={roomOptions}
              />
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <div className="border-b border-border px-6 py-4">
                <h3 className="text-base font-semibold">Sections</h3>
                <p className="text-sm text-muted-foreground">
                  {sections.length} {sections.length === 1 ? 'section' : 'sections'}
                  {academicPeriodId ? ' · active academic period' : ''}
                </p>
              </div>
              {sections.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                  No sections yet. Create a draft section, add meetings on the Timetable tab, then
                  publish.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[44rem] text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                        <th className="px-4 py-3 font-medium">Code</th>
                        <th className="px-4 py-3 font-medium">Name</th>
                        <th className="px-4 py-3 font-medium">Room</th>
                        <th className="px-4 py-3 font-medium">Capacity</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sections.map((section) => (
                        <tr key={section.id} className="border-b border-border/60">
                          <td className="px-4 py-3 font-mono text-xs">{section.code}</td>
                          <td className="px-4 py-3">
                            <Link
                              href={`/institutions/${institutionId}/schedule/${section.id}`}
                              className="font-medium text-foreground underline-offset-4 hover:underline"
                            >
                              {section.name}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {section.defaultRoomId
                              ? (roomLabel.get(section.defaultRoomId) ?? 'Assigned room')
                              : '—'}
                          </td>
                          <td className="px-4 py-3 tabular-nums">{section.capacity}</td>
                          <td className="px-4 py-3 text-xs">
                            <span
                              className={
                                section.status === 'PUBLISHED'
                                  ? 'inline-flex rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700'
                                  : 'inline-flex rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800'
                              }
                            >
                              {section.status === 'PUBLISHED'
                                ? 'Published'
                                : section.status === 'DRAFT'
                                  ? 'Draft'
                                  : section.status === 'ARCHIVED'
                                    ? 'Archived'
                                    : section.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <SectionPublishControls
                              institutionId={institutionId}
                              sectionId={section.id}
                              status={section.status}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
