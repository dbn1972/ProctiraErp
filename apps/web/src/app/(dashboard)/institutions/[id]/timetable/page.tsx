/**
 * Institution timetable — week grid plus meetings list.
 *
 * Route: /institutions/[id]/timetable
 */
import Link from 'next/link';
import { Sparkles, Users } from 'lucide-react';

import { AcademicPeriodSelect } from '@/components/timetable/academic-period-select';
import { ClassBandSelect } from '@/components/timetable/class-band-select';
import { InstitutionWeekGrid } from '@/components/timetable/institution-week-grid';
import { MeetingCreateForm } from '@/components/timetable/meeting-create-form';
import { Button, Card, CardContent } from '@proctira/ui/components';
import { formatCodeNameLabel, formatPersonLabel, resolveEntityLabel } from '@/lib/entity-label';
import { listAcademicPeriods } from '@/lib/institutions/api';
import { listAllStaffResult } from '@/lib/api/staff';
import {
  LoadErrorsAlert,
  StaffTruncationNotice,
} from '@/components/timetable/load-errors-alert';
import { collectFailures } from '@/lib/timetable/load-errors';
import {
  classFilterOptions,
  sectionClassKey,
  slotTitle,
  subjectTone,
} from '@/lib/timetable/subject-label';
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
  searchParams?: Promise<{
    view?: string;
    class?: string;
    day?: string;
    period?: string;
    academicPeriod?: string;
    meeting?: string;
  }>;
}

const DAY_LABELS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function isBreakPeriod(name: string, isBreak?: boolean): boolean {
  return isBreak === true || /^break$/i.test(name);
}

export default async function InstitutionTimetablePage(props: PageProps) {
  const params = await props.params;
  const searchParams = (await props.searchParams) ?? {};
  const institutionId = params.id;
  const view = searchParams.view === 'list' ? 'list' : 'grid';

  let academicPeriods: { id: string; label: string }[] = [];
  let academicPeriodId = '';
  let academicPeriodName = '';
  let academicPeriodsError: string | null = null;
  try {
    const periods = await listAcademicPeriods();
    academicPeriods = periods.map((period) => ({
      id: period.id,
      label: `${period.name} (${period.status === 'active' ? 'Active' : period.status === 'inactive' ? 'Inactive' : 'Archived'})`,
    }));
    const requested = periods.find((period) => period.id === searchParams.academicPeriod);
    const active = periods.find((period) => period.status === 'active') ?? periods[0];
    const chosen = requested ?? active;
    academicPeriodId = chosen?.id ?? '';
    academicPeriodName = chosen?.name ?? '';
  } catch (error) {
    // PRC-M100: a failed read must not render the 'Create an academic period' CTA.
    academicPeriodId = '';
    academicPeriodsError = error instanceof Error ? error.message : 'Could not be loaded.';
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
      // PRC-M101: only this institution's staff are offered.
      listAllStaffResult({ institutionId }),
    ]);

  const meetings = meetingsResult.ok ? meetingsResult.data : [];
  const schedules = schedulesResult.ok ? schedulesResult.data : [];
  const sections = sectionsResult.ok ? sectionsResult.data : [];
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const sectionOptions = sections.map((s) => ({
    id: s.id,
    status: s.status,
    label:
      formatCodeNameLabel(s.code, s.name) +
      ` (${s.status === 'PUBLISHED' ? 'Published' : s.status === 'DRAFT' ? 'Draft' : s.status})`,
  }));
  const sectionLabel = new Map(sectionOptions.map((s) => [s.id, s.label]));
  const rooms = roomsResult.ok ? roomsResult.data : [];
  const roomOptions = rooms.map((r) => ({
    id: r.id,
    label: formatCodeNameLabel(r.code, r.name),
  }));
  const roomCode = new Map(rooms.map((r) => [r.id, r.code]));
  const roomLabel = new Map(roomOptions.map((r) => [r.id, r.label]));
  const staffOptions = (staffResult.ok ? staffResult.items : []).map((s) => ({
    id: s.id,
    label: formatPersonLabel(s.firstName, s.lastName),
  }));
  const staffLabel = new Map(staffOptions.map((s) => [s.id, s.label]));

  const periodRows: {
    id: string;
    name: string;
    startTime: string;
    endTime: string;
    isBreak: boolean;
    scheduleName: string;
  }[] = [];
  const periodResults = await Promise.all(schedules.map((schedule) => listPeriods(schedule.id)));
  for (const [scheduleIndex, schedule] of schedules.entries()) {
    const periods = periodResults[scheduleIndex]!;
    if (!periods.ok) continue;
    for (const p of periods.data) {
      periodRows.push({
        id: p.id,
        name: p.name,
        startTime: p.startTime,
        endTime: p.endTime,
        isBreak: isBreakPeriod(p.name, p.isBreak),
        scheduleName: schedule.name,
      });
    }
  }
  periodRows.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.name.localeCompare(b.name));
  const periodOptions = periodRows
    .filter((p) => !p.isBreak)
    .map((p) => ({
      id: p.id,
      label: `${p.scheduleName} · ${p.name.replace(/^Period\s+/i, 'P')} (${p.startTime}–${p.endTime})`,
    }));
  const periodLabel = new Map(periodOptions.map((p) => [p.id, p.label]));
  const periodStart = new Map(periodRows.map((p) => [p.id, p.startTime]));

  // PRC-M103: default to every class; filter by a per-section key so sections
  // without 'Class N-X' naming remain reachable; the list view honours it too.
  const classOptions = classFilterOptions(sections);
  const requestedClass = searchParams.class ?? 'all';
  const classKey =
    requestedClass === 'all' || classOptions.some((o) => o.value === requestedClass)
      ? requestedClass
      : 'all';
  const classLabel = classOptions.find((o) => o.value === classKey)?.label;
  const visibleMeetings =
    classKey === 'all'
      ? meetings
      : meetings.filter((m) => {
          const section = sectionById.get(m.sectionId);
          return section ? sectionClassKey(section) === classKey : false;
        });
  const gridMeetings = visibleMeetings.map((m) => {
    const section = sectionById.get(m.sectionId);
    const teacher = resolveEntityLabel(m.staffId, staffLabel, 'Teacher');
    const room = m.roomId ? (roomCode.get(m.roomId) ?? 'Room') : '';
    return {
      id: m.id,
      sectionId: m.sectionId,
      dayOfWeek: m.dayOfWeek,
      periodId: m.periodId,
      title: slotTitle(section?.name ?? 'Class'),
      detail: room ? `${teacher} · ${room}` : teacher,
      tone: subjectTone(section?.name ?? ''),
      draft: m.status.toLowerCase() === 'draft' || section?.status === 'DRAFT',
      editable: section?.status === 'DRAFT',
    };
  });

  const loadFailures = collectFailures([
    ['Academic periods', academicPeriodsError ? { ok: false, error: academicPeriodsError } : null],
    ['Section meetings', meetingsResult],
    ['Bell schedules', schedulesResult],
    ['Sections', sectionsResult],
    ['Rooms', roomsResult],
    ['Staff', staffResult],
    ...periodResults.map((r, i): [string, typeof r] => [
      `Periods (${schedules[i]?.name ?? 'schedule'})`,
      r,
    ]),
  ]);
  const query = (next: { view?: string; class?: string }) => {
    const params = new URLSearchParams();
    params.set('view', next.view ?? view);
    params.set('class', next.class ?? classKey);
    if (academicPeriodId) params.set('academicPeriod', academicPeriodId);
    return `/institutions/${institutionId}/timetable?${params.toString()}`;
  };

  const context = [academicPeriodName, schedules[0] ? `${schedules[0].name} schedule` : '']
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-4" data-testid="institution-timetable">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-foreground">Timetable</h2>
          <p className="text-sm text-muted-foreground">
            Weekly section meetings for this institution. Teacher double-bookings are blocked.
          </p>
          {academicPeriods.length > 0 ? (
            <div className="mt-3">
              <AcademicPeriodSelect
                value={academicPeriodId}
                options={academicPeriods}
                preserve={{ view, class: classKey }}
              />
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="min-h-11 gap-1.5">
            <Link href={`/institutions/${institutionId}/timetable/generate`}>
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Generate
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="min-h-11 gap-1.5">
            <Link href={`/institutions/${institutionId}/timetable/substitutions`}>
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              Substitutions
            </Link>
          </Button>
        </div>
      </div>

      {loadFailures.length > 0 ? (
        <LoadErrorsAlert
          title="Timetable data could not be loaded"
          failures={loadFailures}
          retryHref={`/institutions/${institutionId}/timetable${
            searchParams.academicPeriod
              ? `?academicPeriod=${encodeURIComponent(searchParams.academicPeriod)}`
              : ''
          }`}
        />
      ) : !academicPeriodId ? (
        <Card>
          <CardContent className="space-y-2 p-6">
            <h3 className="text-base font-semibold">Add meeting</h3>
            <p className="text-sm text-muted-foreground">
              Create an academic period before editing the timetable.{' '}
              <Link href="/academic-periods" className="font-semibold underline">
                Academic periods
              </Link>
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="space-y-4 p-6">
              <div>
                <h3 className="text-base font-semibold">Add meeting</h3>
                <p className="text-sm text-muted-foreground">
                  One weekly slot for a section. Teacher double-bookings are blocked.
                </p>
              </div>
              {staffResult.ok && staffResult.truncated ? (
                <StaffTruncationNotice
                  shown={staffResult.items.length}
                  total={staffResult.totalItems}
                />
              ) : null}
              <MeetingCreateForm
                key={`${searchParams.day ?? ''}-${searchParams.period ?? ''}`}
                institutionId={institutionId}
                academicPeriodId={academicPeriodId}
                periodOptions={periodOptions}
                sectionOptions={sectionOptions}
                roomOptions={roomOptions}
                staffOptions={staffOptions}
                initial={{
                  dayOfWeek: searchParams.day ? Number(searchParams.day) : undefined,
                  periodId: searchParams.period,
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="flex flex-wrap items-center gap-3">
                <div
                  className="inline-flex overflow-hidden rounded-md border border-border"
                  role="group"
                  aria-label="View"
                >
                  <Link
                    href={query({ view: 'grid' })}
                    className={`px-3 py-1.5 text-xs font-semibold ${view === 'grid' ? 'bg-blue-50 text-blue-800' : 'text-muted-foreground'}`}
                    aria-current={view === 'grid' ? 'page' : undefined}
                  >
                    Week grid
                  </Link>
                  <Link
                    href={query({ view: 'list' })}
                    className={`border-s border-border px-3 py-1.5 text-xs font-semibold ${view === 'list' ? 'bg-blue-50 text-blue-800' : 'text-muted-foreground'}`}
                    aria-current={view === 'list' ? 'page' : undefined}
                  >
                    List
                  </Link>
                </div>
                <ClassBandSelect
                  value={classKey}
                  options={classOptions}
                  preserve={{ view, academicPeriod: academicPeriodId || undefined }}
                />
                {context ? <span className="text-xs text-muted-foreground">{context}</span> : null}
              </div>

              {view === 'list' ? (
                meetings.length === 0 ? (
                  <EmptyMeetings institutionId={institutionId} />
                ) : visibleMeetings.length === 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="class-filter-empty">
                    No meetings for {classLabel ?? 'this class'}.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[40rem] text-sm" aria-label="Meetings">
                      <thead>
                        <tr className="border-b border-border text-start text-muted-foreground">
                          <th className="px-2 py-2 font-medium">Day</th>
                          <th className="px-2 py-2 font-medium">Period</th>
                          <th className="px-2 py-2 font-medium">Section</th>
                          <th className="px-2 py-2 font-medium">Staff</th>
                          <th className="px-2 py-2 font-medium">Room</th>
                          <th className="px-2 py-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleMeetings
                          .slice()
                          .sort(
                            (a, b) =>
                              a.dayOfWeek - b.dayOfWeek ||
                              (periodStart.get(a.periodId) ?? '').localeCompare(
                                periodStart.get(b.periodId) ?? '',
                              ),
                          )
                          .map((m) => (
                            <tr key={m.id} className="border-b border-border/60">
                              <td className="px-2 py-2">
                                {DAY_LABELS[m.dayOfWeek] ?? m.dayOfWeek}
                              </td>
                              <td className="px-2 py-2 text-xs">
                                {resolveEntityLabel(m.periodId, periodLabel, 'Period')}
                              </td>
                              <td className="px-2 py-2 text-xs">
                                {resolveEntityLabel(m.sectionId, sectionLabel, 'Section')}
                              </td>
                              <td className="px-2 py-2 text-xs">
                                {resolveEntityLabel(m.staffId, staffLabel, 'Staff')}
                              </td>
                              <td className="px-2 py-2 text-xs text-muted-foreground">
                                {m.roomId ? resolveEntityLabel(m.roomId, roomLabel, 'Room') : '—'}
                              </td>
                              <td className="px-2 py-2 text-xs">
                                {m.status.toLowerCase() === 'draft' ||
                                sectionById.get(m.sectionId)?.status === 'DRAFT'
                                  ? 'Draft'
                                  : 'Published'}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : meetings.length === 0 ? (
                <EmptyMeetings institutionId={institutionId} />
              ) : (
                <InstitutionWeekGrid
                  institutionId={institutionId}
                  classKey={classKey}
                  academicPeriodId={academicPeriodId}
                  openMeetingId={searchParams.meeting}
                  caption={`Weekly timetable${classLabel ? `, ${classLabel}` : ''}`}
                  periods={periodRows.map((p) => ({
                    id: p.id,
                    label: p.isBreak ? 'Break' : p.name.replace(/^Period\s+/i, 'P'),
                    time: `${p.startTime}–${p.endTime}`,
                    isBreak: p.isBreak,
                  }))}
                  meetings={gridMeetings}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function EmptyMeetings(props: { institutionId: string }) {
  return (
    <div className="px-2 py-8 text-center">
      <h4 className="text-base font-semibold">No meetings scheduled yet</h4>
      <p className="mt-1 text-sm text-muted-foreground">
        Add the first meeting above or run the generator to fill the week.
      </p>
      <Button asChild size="sm" className="mt-3">
        <Link href={`/institutions/${props.institutionId}/timetable/generate`}>
          Generate timetable
        </Link>
      </Button>
    </div>
  );
}
