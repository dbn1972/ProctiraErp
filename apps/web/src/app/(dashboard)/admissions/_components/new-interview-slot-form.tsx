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
} from '@proctira/ui/components';
import { EntitySearchSelect } from '@/components/shared/entity-search-select';
import type { EntityLabelOption } from '@/lib/entity-label';

import { createInterviewSlotAction } from '../../admissions-actions';

export function NewInterviewSlotForm({
  institutions = [],
}: {
  institutions?: EntityLabelOption[];
}) {
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
    const institutionId = String(fd.get('institutionId') ?? '').trim();
    const startsAt = String(fd.get('startsAt') ?? '').trim();
    const endsAt = String(fd.get('endsAt') ?? '').trim();
    const capacity = Number(String(fd.get('capacity') ?? '1'));
    const location = String(fd.get('location') ?? '').trim();
    if (!institutionId || !startsAt || !endsAt) {
      setError('Choose a school and enter the start and end times.');
      return;
    }
    startTransition(async () => {
      setError(null);
      const result = await createInterviewSlotAction({
        institutionId,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        capacity: Number.isFinite(capacity) ? capacity : 1,
        location: location || undefined,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed');
        return;
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Create interview slot</CardTitle>
        <CardDescription>Open a capacity-limited slot for applicant bookings.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-3" aria-busy={pending}>
          <EntitySearchSelect
            id="slot-institution"
            name="institutionId"
            label="School"
            options={institutions}
            required
            placeholder="Search schools by name…"
            emptyMessage="No schools are loaded. Add a school under Institutions, then return here."
          />
          <FormField id="slot-start" label="Starts at" required>
            <Input
              id="slot-start"
              name="startsAt"
              type="datetime-local"
              required
              disabled={!hydrated || pending}
            />
          </FormField>
          <FormField id="slot-end" label="Ends at" required>
            <Input
              id="slot-end"
              name="endsAt"
              type="datetime-local"
              required
              disabled={!hydrated || pending}
            />
          </FormField>
          <FormField id="slot-capacity" label="Capacity">
            <Input
              id="slot-capacity"
              name="capacity"
              type="number"
              min={1}
              defaultValue={1}
              disabled={!hydrated || pending}
            />
          </FormField>
          <FormField id="slot-location" label="Location">
            <Input id="slot-location" name="location" disabled={!hydrated || pending} />
          </FormField>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={!hydrated || pending}>
            {pending ? 'Creating…' : 'Create slot'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
