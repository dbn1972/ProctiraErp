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

export function StatusForm({ applications }: { applications: AdmissionApplication[] }) {
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
    const id = String(fd.get('applicationId') ?? '');
    const status = String(fd.get('status') ?? '') as
      | 'pending'
      | 'under_review'
      | 'approved'
      | 'rejected'
      | 'waitlisted';
    const remarks = String(fd.get('remarks') ?? '').trim();
    if (!id) {
      setError('Select an application.');
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
        <CardDescription>Waitlisted applications are added to the waitlist queue.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-3" aria-busy={pending}>
          <FormField id="status-app" label="Application" required>
            <select
              id="status-app"
              name="applicationId"
              className="flex h-10 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
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
          <FormField id="status-value" label="Status" required>
            <select
              id="status-value"
              name="status"
              className="flex h-10 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              defaultValue="under_review"
              disabled={!hydrated || pending}
            >
              <option value="pending">Pending</option>
              <option value="under_review">Under review</option>
              <option value="waitlisted">Waitlisted</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </FormField>
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
          <Button type="submit" disabled={!hydrated || pending || applications.length === 0}>
            {pending ? 'Saving…' : 'Update status'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
