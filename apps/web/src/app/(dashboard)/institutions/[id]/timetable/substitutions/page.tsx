/**
 * Institution substitution desk.
 *
 * Route: /institutions/[id]/timetable/substitutions
 */
import Link from 'next/link';

import { Button, Card, CardContent } from '@proctira/ui/components';
import { SubstitutionCreateForm } from '@/components/timetable/substitution-create-form';
import { TeacherAbsenceForm } from '@/components/timetable/teacher-absence-form';
import { formatCodeNameLabel, formatPersonLabel, resolveEntityLabel } from '@/lib/entity-label';
import { listStaff } from '@/lib/api/staff';
import {
  listAffectedPeriods,
  listBellSchedules,
  listMeetings,
  listPeriods,
  listRooms,
  listSections,
  listSubstitutions,
} from '@/lib/api/timetable';

export const dynamic = 'force-dynamic';

const DAY_LABELS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatDay(iso: string): string {
  const day = iso.slice(0, 10);
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ staff?: string; date?: string }>;
}

export default async function TimetableSubstitutionsPage(props: PageProps) {
  const params = await props.params;
  const searchParams = (await props.searchParams) ?? {};
  const institutionId = params.id;

  const [subsResult, meetingsResult, staffResult, sectionsResult, roomsResult, schedulesResult] =
    await Promise.all([
      listSubstitutions({ institutionId }),
      listMeetings({ institutionId }),
      (async () => {
        const rows: Awaited<ReturnType<typeof listStaff>>['data'] = [];
        for (let page = 1; page <= 4; page += 1) {
          const batch = await listStaff({ page, pageSize: 100 }).catch(() => ({
            data: [] as Awaited<ReturnType<typeof listStaff>>['data'],
            meta: { page, pageSize: 100, totalItems: 0, totalPages: 0 },
          }));
          rows.push(...batch.data);
          if (batch.data.length < 100) break;
        }
        return { data: rows };
      })(),
      listSections({ institutionId }),
      listRooms({ institutionId }),
      listBellSchedules({ institutionId }),
    ]);

  const substitutions = subsResult.ok ? subsResult.data : [];
  const meetings = meetingsResult.ok ? meetingsResult.data : [];
  const sections = sectionsResult.ok ? sectionsResult.data : [];
  const rooms = roomsResult.ok ? roomsResult.data : [];
  const staffOptions = (staffResult.data ?? []).map((s) => ({
    id: s.id,
    label: formatPersonLabel(s.firstName, s.lastName),
  }));
  const staffLabel = new Map(staffOptions.map((s) => [s.id, s.label]));
  const sectionLabel = new Map(sections.map((s) => [s.id, formatCodeNameLabel(s.code, s.name)]));
  const roomLabel = new Map(rooms.map((r) => [r.id, r.name]));

  const periodLabel = new Map<string, string>();
  for (const schedule of schedulesResult.ok ? schedulesResult.data : []) {
    const periods = await listPeriods(schedule.id);
    if (!periods.ok) continue;
    for (const period of periods.data) {
      const short = period.name.replace(/^Period\s+/i, 'P');
      periodLabel.set(period.id, `${short} · ${period.startTime}–${period.endTime}`);
    }
  }

  const meetingById = new Map(meetings.map((m) => [m.id, m]));
  const meetingOptions = meetings.map((m) => ({
    id: m.id,
    label: `${DAY_LABELS[m.dayOfWeek] ?? m.dayOfWeek} · ${periodLabel.get(m.periodId) ?? 'Period'} · ${resolveEntityLabel(m.sectionId, sectionLabel, 'Section')} · ${resolveEntityLabel(m.staffId, staffLabel, 'Teacher')}`,
    dayOfWeek: m.dayOfWeek,
    periodId: m.periodId,
    sectionId: m.sectionId,
  }));

  const affected =
    searchParams.staff && searchParams.date
      ? await listAffectedPeriods({
          institutionId,
          staffId: searchParams.staff,
          date: searchParams.date,
        })
      : null;
  const affectedRows = affected && affected.ok ? affected.data : [];
  const covered = new Map(
    substitutions
      .filter((s) => !searchParams.date || s.substitutionDate.slice(0, 10) === searchParams.date)
      .map((s) => [
        s.sectionMeetingId,
        resolveEntityLabel(s.substituteStaffId, staffLabel, 'Substitute'),
      ]),
  );

  return (
    <div className="space-y-4" data-testid="timetable-substitutions-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-foreground">Substitutions</h2>
          <p className="text-sm text-muted-foreground">
            Mark a teacher absent for a date, review affected periods, then assign a substitute.
            Overlapping assignments are blocked with a clear error.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/institutions/${institutionId}/timetable`}>Back to grid</Link>
        </Button>
      </div>

      {staffOptions.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 p-6 text-sm text-muted-foreground">
            <h3 className="text-base font-semibold text-foreground">Substitutions</h3>
            <p>Add staff members before marking absences or assigning substitutes.</p>
            <Button asChild variant="outline" size="sm" className="min-h-[44px]">
              <Link href="/staff">Staff directory</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="space-y-4 p-6">
              <div>
                <h3 className="text-base font-semibold">Mark teacher absent</h3>
                <p className="text-sm text-muted-foreground">
                  Step 1 — record the absence and list the periods that need cover.
                </p>
              </div>
              <TeacherAbsenceForm institutionId={institutionId} staffOptions={staffOptions} />
            </CardContent>
          </Card>

          {affected ? (
            <Card>
              <CardContent className="space-y-3 p-0">
                <div className="px-6 pt-6">
                  <h3 className="text-base font-semibold">Affected periods</h3>
                  <p className="text-sm text-muted-foreground">
                    {resolveEntityLabel(searchParams.staff, staffLabel, 'Teacher')} ·{' '}
                    {formatDay(searchParams.date ?? '')}
                  </p>
                </div>
                {affectedRows.length === 0 ? (
                  <p className="px-6 pb-6 text-sm text-muted-foreground">
                    No periods on that date.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[36rem] text-sm" aria-label="Affected periods">
                      <thead>
                        <tr className="border-b border-border text-start text-muted-foreground">
                          <th className="px-6 py-2 font-medium">Period</th>
                          <th className="px-4 py-2 font-medium">Section</th>
                          <th className="px-4 py-2 font-medium">Room</th>
                          <th className="px-4 py-2 font-medium">Cover</th>
                        </tr>
                      </thead>
                      <tbody>
                        {affectedRows.map((m) => (
                          <tr key={m.id} className="border-b border-border/60">
                            <td className="px-6 py-2">{periodLabel.get(m.periodId) ?? 'Period'}</td>
                            <td className="px-4 py-2">
                              {resolveEntityLabel(m.sectionId, sectionLabel, 'Section')}
                            </td>
                            <td className="px-4 py-2">
                              {m.roomId ? resolveEntityLabel(m.roomId, roomLabel, 'Room') : '—'}
                            </td>
                            <td className="px-4 py-2">{covered.get(m.id) ?? 'Unassigned'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardContent className="space-y-4 p-6">
              <div>
                <h3 className="text-base font-semibold">Assign substitute</h3>
                <p className="text-sm text-muted-foreground">
                  Step 2 — pick the meeting slot and a free teacher. Overlapping assignments are
                  blocked.
                </p>
              </div>
              {meetingOptions.length === 0 ? (
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>Generate a timetable first so section meetings exist for substitution.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm" className="min-h-[44px]">
                      <Link href={`/institutions/${institutionId}/timetable/generate`}>
                        Generate timetable
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="sm" className="min-h-[44px]">
                      <Link href="/academic-periods">Academic periods</Link>
                    </Button>
                  </div>
                </div>
              ) : (
                <SubstitutionCreateForm
                  meetingOptions={meetingOptions}
                  staffOptions={staffOptions}
                  sectionLabels={Object.fromEntries(sectionLabel)}
                  periodLabels={Object.fromEntries(periodLabel)}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardContent className="space-y-3 p-0">
          <h3 className="px-6 pt-6 text-base font-semibold">Recent substitutions</h3>
          {substitutions.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">None recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm" aria-label="Recent substitutions">
                <thead>
                  <tr className="border-b border-border text-start text-muted-foreground">
                    <th className="px-6 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Meeting</th>
                    <th className="px-4 py-2 font-medium">Substitute</th>
                    <th className="px-4 py-2 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {substitutions.map((s) => {
                    const meeting = meetingById.get(s.sectionMeetingId);
                    const meetingText = meeting
                      ? `${DAY_LABELS[meeting.dayOfWeek] ?? ''} · ${periodLabel.get(meeting.periodId) ?? 'Period'} · ${resolveEntityLabel(meeting.sectionId, sectionLabel, 'Section')}`
                      : 'Meeting';
                    const absent = resolveEntityLabel(s.originalStaffId, staffLabel, 'Teacher');
                    const cover = resolveEntityLabel(s.substituteStaffId, staffLabel, 'Substitute');
                    return (
                      <tr key={s.id} className="border-b border-border/60">
                        <td className="px-6 py-2">{formatDay(s.substitutionDate)}</td>
                        <td className="px-4 py-2">{meetingText}</td>
                        <td className="px-4 py-2">
                          {absent} → {cover}
                        </td>
                        <td className="px-4 py-2">{s.reason ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
