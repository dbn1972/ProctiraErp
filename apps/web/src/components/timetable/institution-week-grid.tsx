'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import { deleteMeetingAction } from '@/app/(dashboard)/timetable-actions';

export interface GridPeriod {
  id: string;
  label: string;
  time: string;
  isBreak: boolean;
}

export interface GridMeeting {
  id: string;
  sectionId: string;
  dayOfWeek: number;
  periodId: string;
  title: string;
  detail: string;
  tone: string;
  draft: boolean;
  editable: boolean;
}

const TONE: Record<string, string> = {
  c1: 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40',
  c2: 'border-teal-200 bg-teal-50 dark:border-teal-900 dark:bg-teal-950/40',
  c3: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40',
  c4: 'border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/40',
  c5: 'border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/40',
};

const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

export function InstitutionWeekGrid(props: {
  institutionId: string;
  classKey: string;
  academicPeriodId?: string;
  openMeetingId?: string;
  periods: GridPeriod[];
  meetings: GridMeeting[];
  caption: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<GridMeeting | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  useEffect(() => {
    if (!props.openMeetingId) return;
    const meeting = props.meetings.find((item) => item.id === props.openMeetingId);
    if (meeting) setSelected(meeting);
  }, [props.openMeetingId, props.meetings]);

  function prefill(day: number, periodId: string) {
    const params = new URLSearchParams();
    params.set('view', 'grid');
    params.set('class', props.classKey);
    if (props.academicPeriodId) params.set('academicPeriod', props.academicPeriodId);
    params.set('day', String(day));
    params.set('period', periodId);
    router.push(`/institutions/${props.institutionId}/timetable?${params.toString()}#add-meeting`);
  }

  return (
    <div
      id="timetable-week-grid"
      data-testid="timetable-week-grid"
      data-hydrated={ready ? 'true' : 'false'}
    >
      <div className="overflow-x-auto">
        <table
          className="w-full min-w-[760px] border-separate border-spacing-1 text-xs"
          aria-label={props.caption}
        >
          <thead>
            <tr>
              <th className="w-24 px-1 py-1 text-start text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Period
              </th>
              {DAYS.map((day) => (
                <th
                  key={day.value}
                  className="px-1 py-1 text-start text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                >
                  {day.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.periods.map((period) => (
              <tr key={period.id}>
                <th scope="row" className="px-1 py-1 text-start align-top font-bold">
                  {period.label}
                  <span className="mt-0.5 block text-[10px] font-medium normal-case tracking-normal text-muted-foreground">
                    {period.time}
                  </span>
                </th>
                {DAYS.map((day) => {
                  if (period.isBreak) {
                    return (
                      <td key={day.value} className="p-0 align-top">
                        <div className="flex min-h-[52px] items-center justify-center rounded-md bg-[repeating-linear-gradient(135deg,hsl(var(--muted))_0_6px,transparent_6px_12px)] text-xs font-semibold text-muted-foreground">
                          Break
                        </div>
                      </td>
                    );
                  }
                  const meeting = props.meetings.find(
                    (item) => item.dayOfWeek === day.value && item.periodId === period.id,
                  );
                  if (!meeting) {
                    return (
                      <td key={day.value} className="p-0 align-top">
                        <button
                          type="button"
                          data-day={day.value}
                          data-period-id={period.id}
                          className="flex min-h-[52px] w-full items-center justify-center rounded-md border border-dashed border-border text-muted-foreground hover:bg-muted/40"
                          onClick={() => prefill(day.value, period.id)}
                        >
                          Free
                        </button>
                      </td>
                    );
                  }
                  return (
                    <td key={day.value} className="p-0 align-top">
                      <button
                        type="button"
                        className={`min-h-[52px] w-full rounded-md border px-2 py-1.5 text-start ${TONE[meeting.tone] ?? TONE.c5}`}
                        onClick={() => {
                          setError(null);
                          setSelected(meeting);
                        }}
                      >
                        <span className="block text-xs font-semibold">{meeting.title}</span>
                        <span className="block text-[10px] text-muted-foreground">
                          {meeting.detail}
                        </span>
                        {meeting.draft ? (
                          <span className="block text-[10px] font-bold text-amber-700">Draft</span>
                        ) : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-200" /> Published meeting
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500" /> Draft section
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-border" />{' '}
          Free period
        </span>
      </div>

      {selected ? (
        <div
          className="mt-4 rounded-lg border border-border p-4"
          role="dialog"
          aria-label={`Meeting ${selected.title}`}
          data-testid="meeting-detail"
        >
          <p className="text-sm font-semibold">{selected.title}</p>
          <p className="text-sm text-muted-foreground">{selected.detail}</p>
          {selected.editable ? (
            <button
              type="button"
              className="mt-3 text-sm font-semibold text-destructive underline"
              onClick={() => setConfirmRemove(true)}
            >
              Remove meeting
            </button>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              This meeting belongs to a published section. Unpublish that section on the Schedule
              tab before changing or removing it.
            </p>
          )}
          {error ? (
            <p className="mt-2 text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            className="mt-3 block text-sm underline"
            onClick={() => setSelected(null)}
          >
            Close
          </button>
        </div>
      ) : null}

      <ConfirmActionDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove this meeting?"
        description="The slot returns to Free. Students stay enrolled in the section."
        confirmLabel="Remove meeting"
        destructive
        pending={pending}
        testId="remove-meeting"
        onConfirm={() => {
          if (!selected) return;
          setError(null);
          startTransition(async () => {
            const result = await deleteMeetingAction({
              institutionId: props.institutionId,
              meetingId: selected.id,
              sectionId: selected.sectionId,
            });
            if (!result.ok) {
              setError(result.error);
              setConfirmRemove(false);
              return;
            }
            setSelected(null);
            setConfirmRemove(false);
            router.refresh();
          });
        }}
      />
    </div>
  );
}
