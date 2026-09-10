'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

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

import { createContractAction } from '../hr-actions';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function NewContractForm() {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const staffId = String(fd.get('staffId') ?? '').trim();
    if (!UUID_RE.test(staffId)) {
      setError('Staff must be a UUID v4 value.');
      return;
    }
    startTransition(async () => {
      setError(null);
      const result = await createContractAction({
        staffId,
        contractType: String(fd.get('contractType') ?? 'permanent') as
          | 'permanent'
          | 'probation'
          | 'fixed_term'
          | 'visiting'
          | 'intern',
        startDate: String(fd.get('startDate') ?? ''),
        endDate: String(fd.get('endDate') ?? '') || undefined,
        salaryBand: String(fd.get('salaryBand') ?? '') || undefined,
        notes: String(fd.get('notes') ?? '') || undefined,
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
        <CardTitle className="text-base">New contract</CardTitle>
        <CardDescription>
          Type, dates, salary band, and status. Renewal alert fires when end date is within 60 days.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={onSubmit}
          className="grid gap-3 sm:grid-cols-2"
          data-testid="staff-contract-form"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <FormField id="contract-staff" label="Staff UUID" required className="sm:col-span-2">
            <Input id="contract-staff" name="staffId" required disabled={!hydrated || pending} />
          </FormField>
          <FormField id="contract-type" label="Type">
            <select
              id="contract-type"
              name="contractType"
              className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              defaultValue="permanent"
              disabled={!hydrated || pending}
            >
              <option value="permanent">Permanent</option>
              <option value="probation">Probation</option>
              <option value="fixed_term">Fixed term</option>
              <option value="visiting">Visiting</option>
              <option value="intern">Intern</option>
            </select>
          </FormField>
          <FormField id="contract-band" label="Salary band">
            <Input id="contract-band" name="salaryBand" disabled={!hydrated || pending} />
          </FormField>
          <FormField id="contract-start" label="Start" required>
            <Input
              id="contract-start"
              name="startDate"
              type="date"
              required
              disabled={!hydrated || pending}
            />
          </FormField>
          <FormField id="contract-end" label="End">
            <Input id="contract-end" name="endDate" type="date" disabled={!hydrated || pending} />
          </FormField>
          {error ? (
            <p className="sm:col-span-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={!hydrated || pending}>
              {pending ? 'Saving…' : 'Save contract'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
