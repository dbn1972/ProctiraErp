'use client';

/**
 * Edit scholarship program form (PUT /scholarships/programs/:id).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Check } from 'lucide-react';

import {
  Button,
  FormField,
  Input,
  Textarea,
} from '@proctira/ui/components';
import type { ScholarshipProgram } from '@/lib/api/scholarships';

import { updateScholarshipProgramAction } from '../actions';

interface EditProgramFormProps {
  program: ScholarshipProgram;
}

function toDateInput(value: string): string {
  return value.slice(0, 10);
}

export function EditProgramForm({ program }: EditProgramFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const name = String(fd.get('name') ?? '').trim();
    const totalSlots = Number(fd.get('totalSlots'));
    const awardAmount = Number(fd.get('awardAmount'));
    const currency = String(fd.get('currency') ?? '').trim().toUpperCase();
    const applicationStartDate = String(fd.get('applicationStartDate') ?? '');
    const applicationEndDate = String(fd.get('applicationEndDate') ?? '');
    const description = String(fd.get('eligibility') ?? '').trim();
    const statusRaw = String(fd.get('status') ?? program.status).toLowerCase();

    setError(null);
    startTransition(async () => {
      const result = await updateScholarshipProgramAction(program.id, {
        name,
        totalSlots,
        amountPerRecipient: awardAmount,
        currency,
        applicationStartDate,
        applicationEndDate,
        ...(description ? { description } : {}),
        status: statusRaw as 'draft' | 'open' | 'closed' | 'archived',
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Update failed');
        return;
      }
      router.push(`/scholarships/programs/${program.id}`);
      router.refresh();
    });
  }

  return (
    <form className="space-y-5" noValidate onSubmit={onSubmit}>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField id="program-name" label="Name" required>
          <Input
            id="program-name"
            name="name"
            defaultValue={program.name}
            required
          />
        </FormField>
        <FormField id="program-code" label="Code">
          <Input id="program-code" name="code" defaultValue={program.code} disabled />
        </FormField>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <FormField id="program-slots" label="Total slots" required>
          <Input
            id="program-slots"
            name="totalSlots"
            type="number"
            min={1}
            defaultValue={program.totalSlots}
            required
          />
        </FormField>
        <FormField id="program-amount" label="Award amount" required>
          <Input
            id="program-amount"
            name="awardAmount"
            type="number"
            step="0.01"
            defaultValue={program.awardAmount}
            required
          />
        </FormField>
        <FormField id="program-currency" label="Currency" required>
          <Input
            id="program-currency"
            name="currency"
            defaultValue={program.currency}
            maxLength={3}
            required
          />
        </FormField>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <FormField id="program-app-start" label="Application opens" required>
          <Input
            id="program-app-start"
            name="applicationStartDate"
            type="date"
            defaultValue={toDateInput(program.applicationStartDate)}
            required
          />
        </FormField>
        <FormField id="program-app-end" label="Application closes" required>
          <Input
            id="program-app-end"
            name="applicationEndDate"
            type="date"
            defaultValue={toDateInput(program.applicationEndDate)}
            required
          />
        </FormField>
        <FormField id="program-status" label="Status">
          <Input
            id="program-status"
            name="status"
            defaultValue={program.status.toLowerCase()}
            placeholder="open"
          />
        </FormField>
      </div>
      <FormField id="program-eligibility" label="Description / eligibility">
        <Textarea
          id="program-eligibility"
          name="eligibility"
          rows={4}
          defaultValue={program.description ?? ''}
        />
      </FormField>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-3 pt-2">
        <Button asChild variant="outline" type="button">
          <Link href={`/scholarships/programs/${program.id}`}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={isPending}>
          <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
          {isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
