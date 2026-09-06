'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@proctira/ui/components';

import {
  createBellScheduleAction,
  createPeriodAction,
} from '@/app/(dashboard)/timetable-actions';

export function BellScheduleCreateForm(props: {
  academicPeriodId: string;
  institutionId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('Standard day');
  const [dayPattern, setDayPattern] = useState('1,2,3,4,5');

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await createBellScheduleAction({
            academicPeriodId: props.academicPeriodId,
            institutionId: props.institutionId,
            name,
            dayPattern,
          });
          if (!result.ok) {
            setError(
              result.code === 'TIMETABLE_SCHEMA_MISSING'
                ? `${result.error} (apply db/sql/003_sis_timetable_schedule_schema.sql)`
                : result.error,
            );
            return;
          }
          router.refresh();
        });
      }}
    >
      <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm">
        <span className="font-medium text-foreground">Schedule name</span>
        <input
          className="rounded-md border border-border bg-background px-3 py-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>
      <label className="flex min-w-[10rem] flex-col gap-1 text-sm">
        <span className="font-medium text-foreground">Day pattern</span>
        <input
          className="rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
          value={dayPattern}
          onChange={(e) => setDayPattern(e.target.value)}
          aria-describedby="day-pattern-help"
          required
        />
        <span id="day-pattern-help" className="text-xs text-muted-foreground">
          Comma-separated weekdays (1=Mon … 7=Sun)
        </span>
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Saving…' : 'Create schedule'}
      </Button>
      {error && (
        <p className="basis-full text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function PeriodCreateForm(props: {
  bellScheduleId: string;
  academicPeriodId: string;
  nextOrder: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(`P${props.nextOrder}`);
  const [periodOrder, setPeriodOrder] = useState(String(props.nextOrder));
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('08:45');

  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await createPeriodAction({
            bellScheduleId: props.bellScheduleId,
            academicPeriodId: props.academicPeriodId,
            name,
            periodOrder: Number(periodOrder),
            startTime,
            endTime,
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          router.refresh();
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Name</span>
        <input
          className="rounded-md border border-border bg-background px-3 py-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Order</span>
        <input
          type="number"
          min={0}
          className="rounded-md border border-border bg-background px-3 py-2"
          value={periodOrder}
          onChange={(e) => setPeriodOrder(e.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Start</span>
        <input
          className="rounded-md border border-border bg-background px-3 py-2 font-mono"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          pattern="\d{2}:\d{2}"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">End</span>
        <input
          className="rounded-md border border-border bg-background px-3 py-2 font-mono"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          pattern="\d{2}:\d{2}"
          required
        />
      </label>
      <div className="flex items-end">
        <Button type="submit" size="sm" disabled={pending} className="w-full">
          {pending ? 'Adding…' : 'Add period'}
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
