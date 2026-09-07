'use client';

import { useEffect, useState, useTransition } from 'react';
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
  Textarea,
} from '@proctira/ui/components';

import { createStaffLeaveAction } from '../../staff-leave-actions';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function NewStaffLeaveForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const staffId = String(fd.get('staffId') ?? '').trim();
    const leaveType = String(fd.get('leaveType') ?? 'annual') as
      | 'annual'
      | 'sick'
      | 'casual'
      | 'unpaid'
      | 'other';
    const startDate = String(fd.get('startDate') ?? '').trim();
    const endDate = String(fd.get('endDate') ?? '').trim();
    const reason = String(fd.get('reason') ?? '').trim();

    if (!UUID_RE.test(staffId)) {
      setError('Staff must be a UUID v4 value.');
      return;
    }
    if (!startDate || !endDate) {
      setError('Start and end dates are required.');
      return;
    }
    if (endDate < startDate) {
      setError('End date must be on or after start date.');
      return;
    }

    startTransition(async () => {
      setError(null);
      const result = await createStaffLeaveAction({
        staffId,
        leaveType,
        startDate,
        endDate,
        reason: reason || undefined,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to create leave');
        return;
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  return (
    <Card className="max-w-[720px]">
      <CardHeader>
        <CardTitle className="text-base">Request leave</CardTitle>
        <CardDescription>
          Creates a pending staff leave request for HR/principal approval. Payroll is out of scope.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" aria-busy={pending}>
          <FormField id="leave-staff" label="Staff UUID" required>
            <Input id="leave-staff" name="staffId" required disabled={!hydrated || pending} />
          </FormField>
          <FormField id="leave-type" label="Leave type">
            <select
              id="leave-type"
              name="leaveType"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              defaultValue="annual"
              disabled={!hydrated || pending}
            >
              <option value="annual">Annual</option>
              <option value="sick">Sick</option>
              <option value="casual">Casual</option>
              <option value="unpaid">Unpaid</option>
              <option value="other">Other</option>
            </select>
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="leave-start" label="Start date" required>
              <Input
                id="leave-start"
                name="startDate"
                type="date"
                required
                disabled={!hydrated || pending}
              />
            </FormField>
            <FormField id="leave-end" label="End date" required>
              <Input
                id="leave-end"
                name="endDate"
                type="date"
                required
                disabled={!hydrated || pending}
              />
            </FormField>
          </div>
          <FormField id="leave-reason" label="Reason">
            <Textarea id="leave-reason" name="reason" disabled={!hydrated || pending} />
          </FormField>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={!hydrated || pending}>
            {pending ? 'Submitting…' : 'Submit leave'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
