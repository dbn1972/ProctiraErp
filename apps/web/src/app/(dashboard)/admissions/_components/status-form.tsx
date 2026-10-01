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

import { updateApplicationStatusAction } from '../../admissions-actions';
import type { AdmissionApplication } from '@/lib/api/admissions';
import {
  APPLICATION_STATUS_LABELS,
  nextApplicationStatuses,
  requiresConfirmation,
  type ApplicationStatus,
} from './status-transitions';

export function StatusForm({ applications }: { applications: AdmissionApplication[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);
  const [applicationId, setApplicationId] = useState('');

  useEffect(() => {
    setHydrated(true);
  }, []);

  const selected = applications.find((app) => app.id === applicationId);
  const nextStatuses = selected ? nextApplicationStatuses(selected.status) : [];
  const isFinal = Boolean(selected) && nextStatuses.length === 0;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const id = String(fd.get('applicationId') ?? '');
    const status = String(fd.get('status') ?? '') as ApplicationStatus;
    const remarks = String(fd.get('remarks') ?? '').trim();
    if (!id) {
      setError('Select an application.');
      return;
    }
    if (!nextStatuses.includes(status)) {
      setError('Select a valid next status for this application.');
      return;
    }
    if (
      requiresConfirmation(status) &&
      !window.confirm(
        `Mark ${selected?.trackingNumber ?? 'this application'} as ${APPLICATION_STATUS_LABELS[status].toLowerCase()}? This decision is final.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      setError(null);
      const result = await updateApplicationStatusAction({
        id,
        status,
        remarks: remarks || undefined,
      });
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
        <CardTitle className="text-base">Update status</CardTitle>
        <CardDescription>
          Only valid next statuses are offered. Approved and rejected are final decisions.
          Waitlisted applications are added to the waitlist queue.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-3" aria-busy={pending}>
          <FormField id="status-app" label="Application" required>
            <select
              id="status-app"
              name="applicationId"
              className="flex h-10 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              disabled={!hydrated || pending || applications.length === 0}
              value={applicationId}
              onChange={(event) => {
                setApplicationId(event.target.value);
                setError(null);
              }}
            >
              <option value="">Select…</option>
              {applications.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.trackingNumber} — {app.firstName} {app.lastName}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="status-value" label="New status" required>
            <select
              key={applicationId}
              id="status-value"
              name="status"
              className="flex h-10 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              defaultValue={nextStatuses[0] ?? ''}
              disabled={!hydrated || pending || nextStatuses.length === 0}
              aria-describedby={isFinal ? 'status-final-hint' : undefined}
            >
              {nextStatuses.length === 0 ? (
                <option value="">
                  {selected ? 'No further changes' : 'Select an application'}
                </option>
              ) : (
                nextStatuses.map((status) => (
                  <option key={status} value={status}>
                    {APPLICATION_STATUS_LABELS[status]}
                  </option>
                ))
              )}
            </select>
          </FormField>
          {isFinal ? (
            <p id="status-final-hint" className="text-sm text-muted-foreground">
              This application is{' '}
              {APPLICATION_STATUS_LABELS[selected!.status as ApplicationStatus]?.toLowerCase() ??
                selected!.status}{' '}
              and cannot be changed.
            </p>
          ) : null}
          <FormField id="status-remarks" label="Remarks">
            <input
              id="status-remarks"
              name="remarks"
              className="flex h-10 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              disabled={!hydrated || pending}
            />
          </FormField>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            disabled={
              !hydrated || pending || applications.length === 0 || nextStatuses.length === 0
            }
          >
            {pending ? 'Saving…' : 'Update status'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
