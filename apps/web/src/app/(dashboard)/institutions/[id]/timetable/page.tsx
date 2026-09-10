/**
 * Institution timetable grid — Academics redesign (WS1).
 *
 * Route: /institutions/[id]/timetable
 */
import Link from 'next/link';

import { MeetingCreateForm } from '@/components/timetable/meeting-create-form';
import { Button, Card, CardContent } from '@proctira/ui/components';
import { formatCodeNameLabel, formatPersonLabel, resolveEntityLabel } from '@/lib/entity-label';
import { listAcademicPeriods } from '@/lib/institutions/api';
import { listStaff } from '@/lib/api/staff';
import {
  listBellSchedules,
  listMeetings,
  listPeriods,
  listRooms,
  listSections,
} from '@/lib/api/timetable';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

/** Index by ISO weekday 1–7 (unused 0). */
const DAY_LABELS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default async function InstitutionTimetablePage(props: PageProps) {
  const params = await props.params;
  const institutionId = params.id;

  let academicPeriodId = '';
  try {
    const periods = await listAcademicPeriods();
    academicPeriodId = periods.find((p) => p.status === 'active')?.id ?? periods[0]?.id ?? '';
  } catch {
    academicPeriodId = '';
  }

  const [meetingsResult, schedulesResult, sectionsResult, roomsResult, staffResult] =
    await Promise.all([
      listMeetings({ institutionId, academicPeriodId: academicPeriodId || undefined }),
      listBellSchedules({ institutionId }),
      listSections({
        institutionId,
        academicPeriodId: academicPeriodId || undefined,
      }),
      listRooms({ institutionId }),
      listStaff({ pageSize: 100 }).catch(() => ({
        data: [],
        meta: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 },
      })),
    ]);

  const apiError = !meetingsResult.ok
    ? meetingsResult.error
    : !schedulesResult.ok
      ? schedulesResult.error
      : null;

  const meetings = meetingsResult.ok ? meetingsResult.data : [];
  const schedules = schedulesResult.ok ? schedulesResult.data : [];
  const sections = sectionsResult.ok ? sectionsResult.data : [];
  const sectionOptions = sections.map((s) => ({
    id: s.id,
    label: formatCodeNameLabel(s.code, s.name) + ` (${s.status})`,
  }));
  const sectionLabel = new Map(sectionOptions.map((s) => [s.id, s.label]));
  const roomOptions = (roomsResult.ok ? roomsResult.data : []).map((r) => ({
    id: r.id,
    label: formatCodeNameLabel(r.code, r.name),
  }));
  const roomLabel = new Map(roomOptions.map((r) => [r.id, r.label]));
  const staffOptions = (staffResult.data ?? []).map((s) => ({
    id: s.id,
    label: formatPersonLabel(s.firstName, s.lastName, s.position),
  }));
  const staffLabel = new Map(staffOptions.map((s) => [s.id, s.label]));

  const periodOptions: { id: string; label: string }[] = [];
  for (const schedule of schedules) {
    const periods = await listPeriods(schedule.id);
    if (!periods.ok) continue;
    for (const p of periods.data) {
      periodOptions.push({
        id: p.id,
        label: `${schedule.name} · ${p.name} (${p.startTime}–${p.endTime})`,
      });
    }
  }

  const periodLabel = new Map(periodOptions.map((p) => [p.id, p.label]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-foreground">Timetable</h2>
          <p className="text-sm text-muted-foreground">
            Weekly section meetings for this institution. Teacher double-books return HTTP 409.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/institutions/${institutionId}/timetable/generate`}>Generate</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/institutions/${institutionId}/timetable/substitutions`}>
              Substitutions
            </Link>
          </Button>
        </div>
      </div>

      {apiError ? (
        <Card>
          <CardContent className="space-y-2 p-6">
            <p className="text-sm font-semibold">Timetable API unavailable</p>
            <p className="text-sm text-muted-foreground" role="alert">
              {apiError}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="space-y-4 p-6">
              <h3 className="text-base font-semibold">Add meeting</h3>
              {!academicPeriodId ? (
                <p className="text-sm text-muted-foreground">
                  Create an academic period before editing the timetable.
                </p>
              ) : (
                <MeetingCreateForm
                  institutionId={institutionId}
                  academicPeriodId={academicPeriodId}
                  periodOptions={periodOptions}
                  sectionOptions={sectionOptions}
                  roomOptions={roomOptions}
                  staffOptions={staffOptions}
                />
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardContent className="p-0">
              {meetings.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                  No meetings scheduled yet. Empty grid is honest — nothing is mocked.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[40rem] text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                        <th className="px-4 py-3 font-medium">Day</th>
                        <th className="px-4 py-3 font-medium">Period</th>
                        <th className="px-4 py-3 font-medium">Section</th>
                        <th className="px-4 py-3 font-medium">Staff</th>
                        <th className="px-4 py-3 font-medium">Room</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {meetings
                        .slice()
                        .sort(
                          (a, b) =>
                            a.dayOfWeek - b.dayOfWeek || a.periodId.localeCompare(b.periodId),
                        )
                        .map((m) => (
                          <tr key={m.id} className="border-b border-border/60">
                            <td className="px-4 py-3">{DAY_LABELS[m.dayOfWeek] ?? m.dayOfWeek}</td>
                            <td className="px-4 py-3 text-xs">
                              {resolveEntityLabel(m.periodId, periodLabel, 'Period')}
                            </td>
                            <td className="px-4 py-3 text-xs">
                              {resolveEntityLabel(m.sectionId, sectionLabel, 'Section')}
                            </td>
                            <td className="px-4 py-3 text-xs">
                              {resolveEntityLabel(m.staffId, staffLabel, 'Staff')}
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {m.roomId ? resolveEntityLabel(m.roomId, roomLabel, 'Room') : '—'}
                            </td>
                            <td className="px-4 py-3 text-xs">{m.status}</td>
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
