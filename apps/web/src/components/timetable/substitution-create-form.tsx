'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@proctira/ui/components';

import { createSubstitutionAction } from '@/app/(dashboard)/timetable-actions';
import { formatSubstituteClash } from '@/lib/timetable/meeting-conflict-label';

export function SubstitutionCreateForm(props: {
  meetingOptions: {
    id: string;
    label: string;
    dayOfWeek?: number;
    periodId?: string;
    sectionId?: string;
  }[];
  staffOptions?: { id: string; label: string }[];
  sectionLabels?: Record<string, string>;
  periodLabels?: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sectionMeetingId, setSectionMeetingId] = useState(props.meetingOptions[0]?.id ?? '');
  const staffOptions = props.staffOptions ?? [];
  const [substituteStaffId, setSubstituteStaffId] = useState(staffOptions[0]?.id ?? '');
  const [substitutionDate, setSubstitutionDate] = useState(new Date().toISOString().slice(0, 10));
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
            const clash = result.conflicts?.find(
              (item) => item.reason === 'substitute' || item.reason === 'staff',
            );
            if (result.status === 409 && clash) {
              const teacher =
                staffOptions.find((item) => item.id === substituteStaffId)?.label ?? 'This teacher';
              setError(
                `Conflict (409). ${formatSubstituteClash({
                  teacherLabel: teacher,
                  dayOfWeek: clash.dayOfWeek,
                  periodLabel: props.periodLabels?.[clash.periodId] ?? 'that period',
                  sectionLabel: props.sectionLabels?.[clash.sectionId ?? ''] ?? 'another section',
                })}`,
              );
              return;
            }
            setError(result.status === 409 ? `Conflict (409). ${result.error}` : result.error);
            return;
          }
          router.refresh();
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm lg:col-span-2">
        <span className="font-medium">Meeting slot</span>
        <select
          className="h-11 min-h-11 rounded-md border border-border bg-background px-3 py-2"
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
        <span className="font-medium">
          Substitute staff<span className="text-destructive"> *</span>
        </span>
        {staffOptions.length > 0 ? (
          <select
            className="h-11 min-h-11 rounded-md border border-border bg-background px-3 py-2"
            value={substituteStaffId}
            onChange={(e) => setSubstituteStaffId(e.target.value)}
            required
            data-testid="substitute-staff"
          >
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-sm text-muted-foreground" role="status">
            Staff directory is unavailable. Try again when the directory loads.
          </p>
        )}
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Date</span>
        <input
          type="date"
          className="h-11 min-h-11 rounded-md border border-border bg-background px-3 py-2"
          value={substitutionDate}
          onChange={(e) => setSubstitutionDate(e.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm sm:col-span-2 lg:col-span-3">
        <span className="font-medium">Reason (optional)</span>
        <input
          className="h-11 min-h-11 rounded-md border border-border bg-background px-3 py-2"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="flex items-end">
        <Button
          type="submit"
          size="sm"
          disabled={pending || staffOptions.length === 0}
          className="w-full"
        >
          {pending ? 'Saving…' : 'Assign substitute'}
        </Button>
      </div>
      {error && (
        <p
          className="sm:col-span-2 lg:col-span-4 text-sm text-red-600 dark:text-red-400"
          role="alert"
        >
          {error}
        </p>
      )}
    </form>
  );
}
