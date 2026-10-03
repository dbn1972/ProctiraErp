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
import { EntitySearchSelect } from '@/components/shared/entity-search-select';
import { useHydrated } from '@/hooks/useHydrated';
import type { Hostel } from '@/lib/api/hostel';
import type { EntityLabelOption } from '@/lib/entity-label';
import { zonedLocalToUtcIso } from '@/lib/datetime/zoned';

import { requestGatePassAction } from '../../campus-ops-actions';

export function GatePassRequestForm({
  hostels,
  studentOptions = [],
  timeZone = null,
}: {
  hostels: Hostel[];
  studentOptions?: EntityLabelOption[];
  /** PRC-M478: tenant IANA timezone the datetime-local inputs are interpreted in. */
  timeZone?: string | null;
}) {
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
    // PRC-M478: send instants with an explicit offset, never naive local strings.
    const expectedOutAt = zonedLocalToUtcIso(String(fd.get('expectedOutAt') ?? ''), timeZone);
    const expectedInAt = zonedLocalToUtcIso(String(fd.get('expectedInAt') ?? ''), timeZone);
    const reason = String(fd.get('reason') ?? '').trim();
    const requestedBy = String(fd.get('requestedBy') ?? 'resident') as 'resident' | 'parent';
    if (!expectedOutAt || !expectedInAt) {
      setError('Enter both the expected out and expected in date and time.');
      return;
    }
    if (Date.parse(expectedInAt) <= Date.parse(expectedOutAt)) {
      setError('Expected return must be after expected departure.');
      return;
    }
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
        <CardDescription>
          Resident or parent request; warden approves next.
          {timeZone ? ` Times are in ${timeZone}.` : ''}
        </CardDescription>
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
          <div data-testid="hostel-gate-student">
            <EntitySearchSelect
              id="gp-student"
              name="studentId"
              label="Student"
              options={studentOptions}
              required
            />
          </div>
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
