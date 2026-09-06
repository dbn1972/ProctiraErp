'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@proctira/ui/components';

import { createMeetingAction } from '@/app/(dashboard)/timetable-actions';

/** ISO weekday: 1=Mon … 7=Sun (matches 003 schema). */
const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

export function MeetingCreateForm(props: {
  institutionId: string;
  academicPeriodId: string;
  periodOptions: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [periodId, setPeriodId] = useState(props.periodOptions[0]?.id ?? '');
  const [dayOfWeek, setDayOfWeek] = useState('1');

  if (props.periodOptions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Create a bell schedule with periods for this institution before editing the grid.
      </p>
    );
  }

  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await createMeetingAction({
            institutionId: props.institutionId,
            academicPeriodId: props.academicPeriodId,
            sectionId,
            staffId,
            periodId,
            dayOfWeek: Number(dayOfWeek),
          });
          if (!result.ok) {
            setError(
              result.status === 409
                ? `Conflict (409): ${result.error}`
                : result.error,
            );
            return;
          }
          router.refresh();
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Section ID</span>
        <input
          className="rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Staff ID</span>
        <input
          className="rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Period</span>
        <select
          className="rounded-md border border-border bg-background px-3 py-2"
          value={periodId}
          onChange={(e) => setPeriodId(e.target.value)}
          required
        >
          {props.periodOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Day</span>
        <select
          className="rounded-md border border-border bg-background px-3 py-2"
          value={dayOfWeek}
          onChange={(e) => setDayOfWeek(e.target.value)}
        >
          {DAYS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-end">
        <Button type="submit" size="sm" disabled={pending} className="w-full">
          {pending ? 'Saving…' : 'Add meeting'}
        </Button>
      </div>
      {error && (
        <p className="sm:col-span-2 lg:col-span-5 text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
