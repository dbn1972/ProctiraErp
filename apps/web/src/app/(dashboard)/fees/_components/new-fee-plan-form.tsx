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

import { createFeePlanAction } from '../../fees-actions';

export function NewFeePlanForm() {
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
    const name = String(fd.get('name') ?? '').trim();
    const code = String(fd.get('code') ?? '').trim();
    const description = String(fd.get('description') ?? '').trim();
    const amountRupees = Number(String(fd.get('amount') ?? '').trim());
    const frequency = String(fd.get('frequency') ?? 'term') as 'once' | 'term' | 'month' | 'year';

    if (!name || !Number.isFinite(amountRupees) || amountRupees < 0) {
      setError('Name and a non-negative amount are required.');
      return;
    }

    startTransition(async () => {
      setError(null);
      const result = await createFeePlanAction({
        name,
        code: code || undefined,
        description: description || undefined,
        amountCents: Math.round(amountRupees * 100),
        currency: 'INR',
        frequency,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to create plan');
        return;
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  return (
    <Card className="max-w-[720px]">
      <CardHeader>
        <CardTitle className="text-base">Create fee plan</CardTitle>
        <CardDescription>Reusable tuition or fee templates for issuing invoices.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" aria-busy={pending}>
          <FormField id="plan-name" label="Name" required>
            <Input id="plan-name" name="name" required disabled={!hydrated || pending} />
          </FormField>
          <FormField id="plan-code" label="Code (optional)">
            <Input id="plan-code" name="code" disabled={!hydrated || pending} />
          </FormField>
          <FormField id="plan-amount" label="Amount (INR)" required>
            <Input
              id="plan-amount"
              name="amount"
              type="number"
              min="0"
              step="0.01"
              required
              disabled={!hydrated || pending}
            />
          </FormField>
          <FormField id="plan-frequency" label="Frequency">
            <select
              id="plan-frequency"
              name="frequency"
              className="flex h-10 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              defaultValue="term"
              disabled={!hydrated || pending}
            >
              <option value="once">Once</option>
              <option value="term">Term</option>
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>
          </FormField>
          <FormField id="plan-description" label="Description">
            <Textarea id="plan-description" name="description" disabled={!hydrated || pending} />
          </FormField>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={!hydrated || pending}>
            {pending ? 'Creating…' : 'Create plan'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
