'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormField,
  Input,
} from '@proctira/ui/components';

import { createVaccinationAction } from '../actions';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function CreateVaccinationForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const studentId = String(fd.get('studentId') ?? '').trim();
    const vaccineName = String(fd.get('vaccineName') ?? '').trim();
    const doseNumber = Number(fd.get('doseNumber') ?? 1);
    const dateAdministered = String(fd.get('dateAdministered') ?? '').trim();
    const administeredBy = String(fd.get('administeredBy') ?? '').trim();
    const batchNumber = String(fd.get('batchNumber') ?? '').trim();
    const nextDueDate = String(fd.get('nextDueDate') ?? '').trim();
    const notes = String(fd.get('notes') ?? '').trim();

    if (!UUID_RE.test(studentId)) {
      setError('Student ID must be a valid UUID.');
      return;
    }
    if (!vaccineName || !dateAdministered) {
      setError('Vaccine name and date are required.');
      return;
    }

    startTransition(async () => {
      setError(null);
      const result = await createVaccinationAction({
        studentId,
        vaccineName,
        doseNumber: Number.isFinite(doseNumber) && doseNumber >= 1 ? doseNumber : 1,
        dateAdministered,
        administeredBy: administeredBy || undefined,
        batchNumber: batchNumber || undefined,
        nextDueDate: nextDueDate || undefined,
        notes: notes || undefined,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed');
        return;
      }
      router.push('/health/vaccinations');
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record vaccination</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit} data-testid="create-vaccination-form">
          <FormField label="Student ID" htmlFor="studentId">
            <Input id="studentId" name="studentId" required className="min-h-11" />
          </FormField>
          <FormField label="Vaccine name" htmlFor="vaccineName">
            <Input id="vaccineName" name="vaccineName" required className="min-h-11" />
          </FormField>
          <FormField label="Dose number" htmlFor="doseNumber">
            <Input
              id="doseNumber"
              name="doseNumber"
              type="number"
              min={1}
              defaultValue={1}
              className="min-h-11"
            />
          </FormField>
          <FormField label="Date administered" htmlFor="dateAdministered">
            <Input
              id="dateAdministered"
              name="dateAdministered"
              type="date"
              required
              className="min-h-11"
            />
          </FormField>
          <FormField label="Administered by" htmlFor="administeredBy">
            <Input id="administeredBy" name="administeredBy" className="min-h-11" />
          </FormField>
          <FormField label="Batch number" htmlFor="batchNumber">
            <Input id="batchNumber" name="batchNumber" className="min-h-11" />
          </FormField>
          <FormField label="Next due date" htmlFor="nextDueDate">
            <Input id="nextDueDate" name="nextDueDate" type="date" className="min-h-11" />
          </FormField>
          <FormField label="Notes" htmlFor="notes">
            <Input id="notes" name="notes" className="min-h-11" />
          </FormField>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending} className="min-h-11">
            {pending ? 'Saving…' : 'Save vaccination'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
