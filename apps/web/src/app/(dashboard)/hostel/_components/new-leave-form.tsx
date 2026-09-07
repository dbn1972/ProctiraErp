'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';

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

import { createHostelLeaveAction } from '../../campus-actions';
import type { Hostel } from '@/lib/api/hostel';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function NewLeaveForm({ hostels }: { hostels: Hostel[] }) {
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
    const studentId = String(fd.get('studentId') ?? '').trim();
    const hostelId = String(fd.get('hostelId') ?? '').trim();
    const startDate = String(fd.get('startDate') ?? '').trim();
    const endDate = String(fd.get('endDate') ?? '').trim();
    const reason = String(fd.get('reason') ?? '').trim();
    if (!UUID_RE.test(studentId) || !UUID_RE.test(hostelId)) {
      setError('Student and hostel must be UUID v4 values.');
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
      const result = await createHostelLeaveAction({
        studentId,
        hostelId,
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
        <CardTitle className="text-base">Record leave</CardTitle>
        <CardDescription>Creates a leave via POST `/hostel/leaves`.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={onSubmit}
          aria-label="Create hostel leave"
          data-testid="hostel-leave-form"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <FormField id="leave-hostel" label="Hostel" required>
            <select
              id="leave-hostel"
              name="hostelId"
              className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              defaultValue=""
            >
              <option value="" disabled>
                Select hostel…
              </option>
              {hostels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({h.code})
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="leave-student" label="Student UUID" required>
            <Input id="leave-student" name="studentId" className="h-11 min-h-11" />
          </FormField>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField id="leave-start" label="Start date" required>
              <Input id="leave-start" name="startDate" type="date" className="h-11 min-h-11" />
            </FormField>
            <FormField id="leave-end" label="End date" required>
              <Input id="leave-end" name="endDate" type="date" className="h-11 min-h-11" />
            </FormField>
          </div>
          <FormField id="leave-reason" label="Reason">
            <Textarea id="leave-reason" name="reason" rows={3} className="min-h-20" />
          </FormField>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending || hostels.length === 0}>
              <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
              {pending ? 'Saving…' : 'Record leave'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
