'use client';

/**
 * Client form for creating a scholarship program.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
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

import { createScholarshipProgramAction } from '../actions';

export function NewProgramForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const name = String(fd.get('name') ?? '').trim();
    const code = String(fd.get('code') ?? '').trim();
    const totalSlots = Number(fd.get('totalSlots'));
    const awardAmount = Number(fd.get('awardAmount'));
    const currency = String(fd.get('currency') ?? 'INR')
      .trim()
      .toUpperCase();
    const applicationStartDate = String(fd.get('applicationStartDate') ?? '');
    const applicationEndDate = String(fd.get('applicationEndDate') ?? '');
    const eligibilityNotes = String(fd.get('eligibility') ?? '').trim();

    if (!name) {
      setError('Program name is required.');
      return;
    }
    if (!code) {
      setError('Program code is required.');
      return;
    }
    if (!Number.isFinite(totalSlots) || totalSlots < 1) {
      setError('Total slots must be at least 1.');
      return;
    }
    if (!Number.isFinite(awardAmount) || awardAmount <= 0) {
      setError('Award amount must be greater than 0.');
      return;
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      setError('Currency must be a 3-letter ISO code.');
      return;
    }
    if (!applicationStartDate || !applicationEndDate) {
      setError('Application window dates are required.');
      return;
    }
    if (applicationEndDate < applicationStartDate) {
      setError('Application end date must be on or after the start date.');
      return;
    }

    startTransition(async () => {
      setError(null);
      const result = await createScholarshipProgramAction({
        name,
        code,
        totalSlots,
        awardAmount,
        currency,
        applicationStartDate,
        applicationEndDate,
        eligibilityNotes: eligibilityNotes || undefined,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to create program');
        return;
      }
      router.push(
        result.programId ? `/scholarships/programs/${result.programId}` : '/scholarships',
      );
      router.refresh();
    });
  }

  return (
    <Card className="max-w-[860px]">
      <CardHeader>
        <CardTitle className="text-base">Program details</CardTitle>
        <CardDescription>
          Set the award amount, eligibility, and the application window.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          noValidate
          onSubmit={onSubmit}
          aria-label="Create scholarship program"
          data-testid="scholarship-program-form"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <FormField id="program-name" label="Name" required>
              <Input
                id="program-name"
                name="name"
                placeholder="Academic Excellence Award"
                required
              />
            </FormField>
            <FormField id="program-code" label="Code" required>
              <Input id="program-code" name="code" placeholder="AEA-2025" required />
            </FormField>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <FormField id="program-slots" label="Total slots" required>
              <Input id="program-slots" name="totalSlots" type="number" min="1" required />
            </FormField>
            <FormField id="program-amount" label="Award amount" required>
              <Input id="program-amount" name="awardAmount" type="number" step="0.01" required />
            </FormField>
            <FormField id="program-currency" label="Currency" required>
              <Input
                id="program-currency"
                name="currency"
                placeholder="INR"
                maxLength={3}
                defaultValue="INR"
                required
              />
            </FormField>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField id="program-app-start" label="Application opens" required>
              <Input id="program-app-start" name="applicationStartDate" type="date" required />
            </FormField>
            <FormField id="program-app-end" label="Application closes" required>
              <Input id="program-app-end" name="applicationEndDate" type="date" required />
            </FormField>
          </div>
          <FormField id="program-eligibility" label="Eligibility criteria">
            <Textarea
              id="program-eligibility"
              name="eligibility"
              rows={4}
              placeholder="Describe academic, demographic, or financial criteria…"
            />
          </FormField>

          {error ? (
            <p className="text-sm text-destructive" role="alert" data-testid="scholarship-program-error">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-3 pt-2">
            <Button asChild variant="outline" type="button">
              <Link href="/scholarships">Cancel</Link>
            </Button>
            <Button type="submit" disabled={pending}>
              <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
              {pending ? 'Creating…' : 'Create program'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
