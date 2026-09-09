'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@proctira/ui/components';

import { markTeacherAbsentAction } from '@/app/(dashboard)/timetable-actions';

export function TeacherAbsenceForm(props: {
  institutionId: string;
  staffOptions: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [staffId, setStaffId] = useState(props.staffOptions[0]?.id ?? '');
  const [absenceDate, setAbsenceDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');

  if (props.staffOptions.length === 0) {
    return <p className="text-sm text-muted-foreground">No staff on file to mark absent.</p>;
  }

  return (
    <form
      className="grid gap-3 sm:grid-cols-3"
      data-testid="teacher-absence-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setInfo(null);
        startTransition(async () => {
          const result = await markTeacherAbsentAction({
            institutionId: props.institutionId,
            staffId,
            absenceDate,
            reason: reason || null,
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setInfo(`${result.affectedCount ?? 0} periods affected.`);
          router.refresh();
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Teacher</span>
        <select
          className="rounded-md border border-border bg-background px-3 py-2"
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
          required
        >
          {props.staffOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Absence date</span>
        <input
          className="rounded-md border border-border bg-background px-3 py-2"
          type="date"
          value={absenceDate}
          onChange={(e) => setAbsenceDate(e.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Reason</span>
        <input
          className="rounded-md border border-border bg-background px-3 py-2"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {error ? (
        <p className="text-sm text-destructive sm:col-span-3" role="alert">
          {error}
        </p>
      ) : null}
      {info ? (
        <p className="text-sm text-muted-foreground sm:col-span-3" role="status">
          {info}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} data-testid="mark-teacher-absent">
        {pending ? 'Saving…' : 'Mark absent and list periods'}
      </Button>
    </form>
  );
}
