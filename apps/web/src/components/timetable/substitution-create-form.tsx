'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@proctira/ui/components';

import { createSubstitutionAction } from '@/app/(dashboard)/timetable-actions';

export function SubstitutionCreateForm(props: {
  meetingOptions: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sectionMeetingId, setSectionMeetingId] = useState(
    props.meetingOptions[0]?.id ?? '',
  );
  const [substituteStaffId, setSubstituteStaffId] = useState('');
  const [substitutionDate, setSubstitutionDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [reason, setReason] = useState('');

  if (props.meetingOptions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No timetable meetings available. Add meetings on an institution timetable first.
      </p>
    );
  }

  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await createSubstitutionAction({
            sectionMeetingId,
            substituteStaffId,
            substitutionDate,
            reason: reason || null,
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
      <label className="flex flex-col gap-1 text-sm lg:col-span-2">
        <span className="font-medium">Meeting slot</span>
        <select
          className="rounded-md border border-border bg-background px-3 py-2"
          value={sectionMeetingId}
          onChange={(e) => setSectionMeetingId(e.target.value)}
          required
        >
          {props.meetingOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Substitute staff ID</span>
        <input
          className="rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
          value={substituteStaffId}
          onChange={(e) => setSubstituteStaffId(e.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Date</span>
        <input
          type="date"
          className="rounded-md border border-border bg-background px-3 py-2"
          value={substitutionDate}
          onChange={(e) => setSubstitutionDate(e.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm sm:col-span-2 lg:col-span-3">
        <span className="font-medium">Reason (optional)</span>
        <input
          className="rounded-md border border-border bg-background px-3 py-2"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="flex items-end">
        <Button type="submit" size="sm" disabled={pending} className="w-full">
          {pending ? 'Saving…' : 'Assign substitute'}
        </Button>
      </div>
      {error && (
        <p className="sm:col-span-2 lg:col-span-4 text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
