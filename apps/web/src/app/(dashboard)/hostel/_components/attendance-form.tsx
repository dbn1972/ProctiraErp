'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
} from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';

import { recordHostelAttendanceAction } from '../../campus-ops-actions';
import type { HostelBlock } from '@/lib/api/hostel';

export function HostelAttendanceForm({
  blocks,
  defaultBlockId,
  defaultDate,
}: {
  blocks: HostelBlock[];
  defaultBlockId?: string;
  defaultDate: string;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const blockId = String(fd.get('blockId') ?? '').trim();
    const studentId = String(fd.get('studentId') ?? '').trim();
    const onDate = String(fd.get('onDate') ?? '').trim();
    const status = String(fd.get('status') ?? '') as 'present' | 'absent' | 'leave';
    const reason = String(fd.get('reason') ?? '').trim();
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await recordHostelAttendanceAction({
        blockId,
        studentId,
        onDate,
        status,
        reason: reason || undefined,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Attendance failed');
        return;
      }
      setMessage(result.message ?? 'Recorded.');
      router.refresh();
    });
  }

  return (
    <Card className="max-w-[720px]">
      <CardHeader>
        <CardTitle className="text-base">Night roll call</CardTitle>
        <CardDescription>Present, absent, or leave per block and date.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={onSubmit}
          aria-label="Record hostel attendance"
          data-testid="hostel-attendance-form"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <FormField id="att-block" label="Block" required>
            <select
              id="att-block"
              name="blockId"
              className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              defaultValue={defaultBlockId ?? ''}
            >
              <option value="" disabled>
                Select block…
              </option>
              {blocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="att-student" label="Student UUID" required>
            <Input id="att-student" name="studentId" className="h-11 min-h-11" />
          </FormField>
          <FormField id="att-date" label="Date" required>
            <Input
              id="att-date"
              name="onDate"
              type="date"
              defaultValue={defaultDate}
              className="h-11 min-h-11"
            />
          </FormField>
          <FormField id="att-status" label="Status" required>
            <select
              id="att-status"
              name="status"
              className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              defaultValue="present"
            >
              <option value="present">Present</option>
              <option value="absent">Absent</option>
              <option value="leave">Leave</option>
            </select>
          </FormField>
          <FormField id="att-reason" label="Reason">
            <Input id="att-reason" name="reason" className="h-11 min-h-11" />
          </FormField>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {message ? (
            <p className="text-sm text-muted-foreground" role="status">
              {message}
            </p>
          ) : null}
          <Button type="submit" disabled={pending} className="min-h-11">
            {pending ? 'Saving…' : 'Record mark'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
