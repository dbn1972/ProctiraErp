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
} from '@proctira/ui/components';

import { bookInterviewAction } from '../../admissions-actions';
import type { AdmissionApplication, InterviewSlot } from '@/lib/api/admissions';

export function BookInterviewForm({
  applications,
  slots,
}: {
  applications: AdmissionApplication[];
  slots: InterviewSlot[];
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
    const applicationId = String(fd.get('applicationId') ?? '');
    const slotId = String(fd.get('slotId') ?? '');
    if (!applicationId || !slotId) {
      setError('Select application and slot.');
      return;
    }
    startTransition(async () => {
      setError(null);
      const result = await bookInterviewAction({ applicationId, slotId });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed');
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Book interview</CardTitle>
        <CardDescription>Assign an applicant to an open slot (capacity enforced).</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-3" aria-busy={pending}>
          <FormField id="book-app" label="Application" required>
            <select
              id="book-app"
              name="applicationId"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              disabled={!hydrated || pending || applications.length === 0}
              defaultValue=""
            >
              <option value="">Select…</option>
              {applications.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.trackingNumber} — {app.firstName} {app.lastName}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="book-slot" label="Slot" required>
            <select
              id="book-slot"
              name="slotId"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              disabled={!hydrated || pending || slots.length === 0}
              defaultValue=""
            >
              <option value="">Select…</option>
              {slots.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {new Date(slot.startsAt).toLocaleString()} (cap {slot.capacity})
                </option>
              ))}
            </select>
          </FormField>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            disabled={!hydrated || pending || applications.length === 0 || slots.length === 0}
          >
            {pending ? 'Booking…' : 'Book interview'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
