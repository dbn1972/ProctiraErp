'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
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
} from '@proctira/ui/components';

import { EntitySearchSelect } from '@/components/shared/entity-search-select';
import type { HostelBed, HostelFeeStructure } from '@/lib/api/hostel';
import type { EntityLabelOption } from '@/lib/entity-label';
import { createHostelAssignmentAction } from '../../campus-actions';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function NewHostelAssignmentForm({
  beds,
  feeStructures,
  studentOptions = [],
}: {
  beds: HostelBed[];
  feeStructures: HostelFeeStructure[];
  studentOptions?: EntityLabelOption[];
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
    const studentId = String(fd.get('studentId') ?? '').trim();
    const bedId = String(fd.get('bedId') ?? '').trim();
    const startDate = String(fd.get('startDate') ?? '').trim();
    const endDate = String(fd.get('endDate') ?? '').trim();
    const feeStructureId = String(fd.get('feeStructureId') ?? '').trim();
    if (!UUID_RE.test(studentId)) {
      setError(
        studentOptions.length === 0
          ? 'Student directory is empty — add students before assigning a bed.'
          : 'Select a student.',
      );
      return;
    }
    if (!bedId) {
      setError('Select a bed.');
      return;
    }
    if (!startDate) {
      setError('Start date is required.');
      return;
    }

    startTransition(async () => {
      setError(null);
      const result = await createHostelAssignmentAction({
        studentId,
        bedId,
        startDate,
        endDate: endDate || undefined,
        feeStructureId: feeStructureId || undefined,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to create assignment');
        return;
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  return (
    <Card className="max-w-[720px]">
      <CardHeader>
        <CardTitle className="text-base">Assign bed</CardTitle>
        <CardDescription>Assign a student to an available bed.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={onSubmit}
          aria-label="Create hostel assignment"
          data-testid="hostel-assignment-form"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <EntitySearchSelect
            id="assign-student"
            name="studentId"
            label="Student"
            options={studentOptions}
            required
          />
          <FormField id="assign-bed" label="Bed" required>
            {beds.length > 0 ? (
              <select
                id="assign-bed"
                name="bedId"
                className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue=""
              >
                <option value="" disabled>
                  Select bed…
                </option>
                {beds.map((bed) => (
                  <option key={bed.id} value={bed.id}>
                    {bed.bedLabel}
                    {bed.isAvailable ? '' : ' (unavailable)'}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id="assign-bed"
                name="bedId"
                className="h-11 min-h-11"
                placeholder="Bed UUID"
              />
            )}
          </FormField>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField id="assign-start" label="Start date" required>
              <Input id="assign-start" name="startDate" type="date" className="h-11 min-h-11" />
            </FormField>
            <FormField id="assign-end" label="End date">
              <Input id="assign-end" name="endDate" type="date" className="h-11 min-h-11" />
            </FormField>
          </div>
          <FormField id="assign-fee" label="Fee structure (optional)">
            <select
              id="assign-fee"
              name="feeStructureId"
              className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              defaultValue=""
            >
              <option value="">No invoice</option>
              {feeStructures.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.roomType} · {row.termLabel} · {row.amountCents}¢
                </option>
              ))}
            </select>
          </FormField>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending || studentOptions.length === 0}>
              <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
              {pending ? 'Saving…' : 'Assign bed'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
