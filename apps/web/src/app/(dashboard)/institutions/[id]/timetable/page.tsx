/**
 * Institution timetable grid — Academics redesign (WS1).
 *
 * Route: /institutions/[id]/timetable
 */
import { MeetingCreateForm } from '@/components/timetable/meeting-create-form';
import { Card, CardContent } from '@proctira/ui/components';
import { listAcademicPeriods } from '@/lib/institutions/api';
import {
  listBellSchedules,
  listMeetings,
  listPeriods,
  listRooms,
  listSections,
} from '@/lib/api/timetable';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

/** Index by ISO weekday 1–7 (unused 0). */
const DAY_LABELS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default async function InstitutionTimetablePage({ params }: PageProps) {
  const institutionId = params.id;

  let academicPeriodId = '';
  try {
    const periods = await listAcademicPeriods();
    academicPeriodId =
      periods.find((p) => p.status === 'active')?.id ?? periods[0]?.id ?? '';
  } catch {
    academicPeriodId = '';
  }

  const [meetingsResult, schedulesResult, sectionsResult, roomsResult] =
    await Promise.all([
      listMeetings({ institutionId, academicPeriodId: academicPeriodId || undefined }),
      listBellSchedules({ institutionId }),
      listSections({
        institutionId,
        academicPeriodId: academicPeriodId || undefined,
      }),
      listRooms({ institutionId }),
    ]);

  const apiError = !meetingsResult.ok
    ? meetingsResult.error
    : !schedulesResult.ok
      ? schedulesResult.error
      : null;

  const meetings = meetingsResult.ok ? meetingsResult.data : [];
  const schedules = schedulesResult.ok ? schedulesResult.data : [];
  const sectionOptions = (sectionsResult.ok ? sectionsResult.data : []).map((s) => ({
    id: s.id,
    label: `${s.code} · ${s.name} (${s.status})`,
  }));
  const roomOptions = (roomsResult.ok ? roomsResult.data : []).map((r) => ({
    id: r.id,
    label: `${r.code} · ${r.name}`,
  }));

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
      <div>
        <h2 className="text-lg font-bold tracking-tight text-foreground">Timetable</h2>
        <p className="text-sm text-muted-foreground">
          Weekly section meetings for this institution. Teacher double-books return HTTP 409.
        </p>
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
                        .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.periodId.localeCompare(b.periodId))
                        .map((m) => (
                          <tr key={m.id} className="border-b border-border/60">
                            <td className="px-4 py-3">{DAY_LABELS[m.dayOfWeek] ?? m.dayOfWeek}</td>
                            <td className="px-4 py-3 text-xs">
                              {periodLabel.get(m.periodId) ?? (
                                <span className="font-mono">{m.periodId.slice(0, 8)}…</span>
                              )}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs">{m.sectionId}</td>
                            <td className="px-4 py-3 font-mono text-xs">{m.staffId}</td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {m.roomId ?? '—'}
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
