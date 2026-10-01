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
  Textarea,
} from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';

import { EntitySearchSelect } from '@/components/shared/entity-search-select';
import type { EntityLabelOption } from '@/lib/entity-label';
import { contractFormSchema } from '@/lib/validation/staff-schema';
import { createContractAction } from '../hr-actions';
type ContractField = 'staffId' | 'startDate' | 'endDate' | 'salaryBand' | 'notes';

export function NewContractForm({ staffOptions = [] }: { staffOptions?: EntityLabelOption[] }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ContractField, string>>>({});
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const fd = new FormData(formEl);
    setError(null);
    setSuccess(null);
    // Same schema the server action uses (z.string().uuid() + end >= start).
    const parsed = contractFormSchema.safeParse({
      staffId: String(fd.get('staffId') ?? '').trim(),
      contractType: String(fd.get('contractType') ?? 'permanent'),
      startDate: String(fd.get('startDate') ?? ''),
      endDate: String(fd.get('endDate') ?? ''),
      salaryBand: String(fd.get('salaryBand') ?? '').trim(),
      notes: String(fd.get('notes') ?? '').trim(),
    });
    if (!parsed.success) {
      const next: Partial<Record<ContractField, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as ContractField | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      if (next.staffId) {
        next.staffId =
          staffOptions.length === 0
            ? 'Staff directory is empty — add staff before recording a contract.'
            : 'Select a staff member.';
      }
      setFieldErrors(next);
      return;
    }
    setFieldErrors({});
    const values = parsed.data;
    startTransition(async () => {
      const result = await createContractAction({
        staffId: values.staffId,
        contractType: values.contractType,
        startDate: values.startDate,
        endDate: values.endDate || undefined,
        salaryBand: values.salaryBand || undefined,
        notes: values.notes || undefined,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to create contract');
        return;
      }
      formEl.reset();
      setSuccess(result.message ?? 'Contract recorded.');
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New contract</CardTitle>
        <CardDescription>
          Type, dates, salary band, and notes. New contracts start active; a renewal alert shows
          when the end date is within 60 days.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={onSubmit}
          className="grid gap-3 sm:grid-cols-2"
          data-testid="staff-contract-form"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <div className="sm:col-span-2">
            <EntitySearchSelect
              id="contract-staff"
              name="staffId"
              label="Staff"
              options={staffOptions}
              required
            />
            {fieldErrors.staffId ? (
              <p className="mt-1 text-xs font-medium text-destructive" role="alert">
                {fieldErrors.staffId}
              </p>
            ) : null}
          </div>
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
          <FormField id="contract-band" label="Salary band" error={fieldErrors.salaryBand}>
            <Input id="contract-band" name="salaryBand" disabled={!hydrated || pending} />
          </FormField>
          <FormField id="contract-start" label="Start" required error={fieldErrors.startDate}>
            <Input
              id="contract-start"
              name="startDate"
              type="date"
              required
              disabled={!hydrated || pending}
            />
          </FormField>
          <FormField id="contract-end" label="End" error={fieldErrors.endDate}>
            <Input id="contract-end" name="endDate" type="date" disabled={!hydrated || pending} />
          </FormField>
          <div className="sm:col-span-2">
            <FormField id="contract-notes" label="Notes" error={fieldErrors.notes}>
              <Textarea
                id="contract-notes"
                name="notes"
                rows={3}
                maxLength={2000}
                disabled={!hydrated || pending}
              />
            </FormField>
          </div>
          {error ? (
            <p className="sm:col-span-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {success ? (
            <p className="sm:col-span-2 text-sm text-muted-foreground" role="status">
              {success}
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
