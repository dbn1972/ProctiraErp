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
  Textarea,
} from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';

import { requestGatePassAction } from '../../campus-ops-actions';
import type { Hostel } from '@/lib/api/hostel';

export function GatePassRequestForm({ hostels }: { hostels: Hostel[] }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const hostelId = String(fd.get('hostelId') ?? '').trim();
    const studentId = String(fd.get('studentId') ?? '').trim();
    const expectedOutAt = String(fd.get('expectedOutAt') ?? '').trim();
    const expectedInAt = String(fd.get('expectedInAt') ?? '').trim();
    const reason = String(fd.get('reason') ?? '').trim();
    const requestedBy = String(fd.get('requestedBy') ?? 'resident') as 'resident' | 'parent';
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await requestGatePassAction({
        hostelId,
        studentId,
        expectedOutAt,
        expectedInAt,
        reason: reason || undefined,
        requestedBy,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Request failed');
        return;
      }
      setMessage(result.message ?? 'Requested.');
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  return (
    <Card className="max-w-[720px]">
      <CardHeader>
        <CardTitle className="text-base">Request gate pass</CardTitle>
        <CardDescription>Resident or parent request; warden approves next.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={onSubmit}
          aria-label="Request hostel gate pass"
          data-testid="hostel-gate-pass-form"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <FormField id="gp-hostel" label="Hostel" required>
            <select
              id="gp-hostel"
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
          <FormField id="gp-student" label="Student UUID" required>
            <Input
              id="gp-student"
              name="studentId"
              className="h-11 min-h-11"
              data-testid="hostel-gate-student"
            />
          </FormField>
          <FormField id="gp-who" label="Requested by">
            <select
              id="gp-who"
              name="requestedBy"
              className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              defaultValue="resident"
            >
              <option value="resident">Resident</option>
              <option value="parent">Parent</option>
            </select>
          </FormField>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField id="gp-out" label="Expected out" required>
              <Input
                id="gp-out"
                name="expectedOutAt"
                type="datetime-local"
                className="h-11 min-h-11"
              />
            </FormField>
            <FormField id="gp-in" label="Expected in" required>
              <Input
                id="gp-in"
                name="expectedInAt"
                type="datetime-local"
                className="h-11 min-h-11"
              />
            </FormField>
          </div>
          <FormField id="gp-reason" label="Reason">
            <Textarea id="gp-reason" name="reason" rows={3} className="min-h-20" />
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
            {pending ? 'Saving…' : 'Request pass'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
