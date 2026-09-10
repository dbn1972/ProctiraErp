'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { Button } from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';
import type { Staff, StaffAttendanceMark, StaffAttendanceStatus } from '@/lib/api/staff';

import { saveAttendanceAction } from '../hr-actions';

const STATUSES: StaffAttendanceStatus[] = ['present', 'absent', 'leave', 'half_day'];

export function StaffAttendanceGrid({
  date,
  staff,
  marks,
}: {
  date: string;
  staff: Staff[];
  marks: StaffAttendanceMark[];
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const initial = useMemo(() => {
    const map: Record<string, StaffAttendanceStatus> = {};
    for (const mark of marks) map[mark.staffId] = mark.status as StaffAttendanceStatus;
    return map;
  }, [marks]);
  const [draft, setDraft] = useState<Record<string, StaffAttendanceStatus>>(initial);

  function onSave() {
    const payload = staff
      .map((member) => {
        const status = draft[member.id];
        return status ? { staffId: member.id, status } : null;
      })
      .filter((row): row is { staffId: string; status: StaffAttendanceStatus } => row != null);
    if (payload.length === 0) {
      setError('Mark at least one staff member.');
      return;
    }
    startTransition(async () => {
      setError(null);
      const result = await saveAttendanceAction({ date, marks: payload });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div
      className="space-y-3"
      data-testid="staff-attendance-grid"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      {staff.length === 0 ? (
        <p className="text-sm text-muted-foreground" role="status">
          No staff records to mark.
        </p>
      ) : (
        <ul className="divide-y divide-border" role="list">
          {staff.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <p className="text-sm font-medium text-foreground">
                {member.firstName} {member.lastName}
              </p>
              <fieldset className="flex flex-wrap gap-2" disabled={!hydrated || pending}>
                <legend className="sr-only">
                  Attendance for {member.firstName} {member.lastName}
                </legend>
                {STATUSES.map((status) => (
                  <label key={status} className="flex items-center gap-1 text-xs">
                    <input
                      type="radio"
                      name={`att-${member.id}`}
                      value={status}
                      checked={draft[member.id] === status}
                      onChange={() => setDraft((prev) => ({ ...prev, [member.id]: status }))}
                    />
                    {status.replace('_', '-')}
                  </label>
                ))}
              </fieldset>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="button" onClick={onSave} disabled={!hydrated || pending || staff.length === 0}>
        {pending ? 'Saving…' : 'Save attendance'}
      </Button>
    </div>
  );
}
