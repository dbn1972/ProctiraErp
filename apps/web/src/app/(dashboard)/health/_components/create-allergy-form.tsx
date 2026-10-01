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

import type { EntityLabelOption } from '@/lib/entity-label';
import { HealthStudentSelect } from './health-directory-select';
import { createAllergyAction } from '../actions';

const SEVERITIES = ['mild', 'moderate', 'severe', 'life-threatening'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function CreateAllergyForm({ studentOptionsJson = '[]' }: { studentOptionsJson?: string }) {
  const studentOptions: EntityLabelOption[] = JSON.parse(studentOptionsJson) as EntityLabelOption[];
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // PRC-L240: per-field errors so the invalid control is announced, not just a page alert.
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<'studentId' | 'allergyType' | 'description', string>>
  >({});
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const studentId = String(fd.get('studentId') ?? '').trim();
    const allergyType = String(fd.get('allergyType') ?? '').trim();
    const description = String(fd.get('description') ?? '').trim();
    const severity = String(fd.get('severity') ?? 'mild').trim();
    const reaction = String(fd.get('reaction') ?? '').trim();
    const treatment = String(fd.get('treatment') ?? '').trim();
    const diagnosedDate = String(fd.get('diagnosedDate') ?? '').trim();

    const nextErrors: typeof fieldErrors = {};
    if (!UUID_RE.test(studentId)) {
      nextErrors.studentId =
        studentOptions.length === 0
          ? 'Student directory is empty — add students before recording an allergy.'
          : 'Select a student.';
    }
    if (!allergyType) nextErrors.allergyType = 'Allergy type is required.';
    if (!description) nextErrors.description = 'Description is required.';
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setError(null);
      return;
    }

    startTransition(async () => {
      setError(null);
      const result = await createAllergyAction({
        studentId,
        allergyType,
        description,
        severity: severity as (typeof SEVERITIES)[number],
        reaction: reaction || undefined,
        treatment: treatment || undefined,
        diagnosedDate: diagnosedDate || undefined,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed');
        return;
      }
      router.push('/health/allergies');
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record allergy</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit} data-testid="create-allergy-form">
          <HealthStudentSelect options={studentOptions} error={fieldErrors.studentId} />
          <FormField
            label="Allergy type"
            htmlFor="allergyType"
            required
            error={fieldErrors.allergyType}
          >
            <Input
              id="allergyType"
              name="allergyType"
              required
              placeholder="food / drug / environmental"
              className="min-h-11"
            />
          </FormField>
          <FormField
            label="Description"
            htmlFor="description"
            required
            error={fieldErrors.description}
          >
            <Input id="description" name="description" required className="min-h-11" />
          </FormField>
          <FormField label="Severity" htmlFor="severity">
            <select
              id="severity"
              name="severity"
              className="min-h-11 w-full rounded-md border border-input bg-background px-3"
              defaultValue="mild"
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Reaction (optional)" htmlFor="reaction">
            <Input id="reaction" name="reaction" className="min-h-11" />
          </FormField>
          <FormField label="Treatment (optional)" htmlFor="treatment">
            <Input id="treatment" name="treatment" className="min-h-11" />
          </FormField>
          <FormField label="Diagnosed date" htmlFor="diagnosedDate">
            <Input id="diagnosedDate" name="diagnosedDate" type="date" className="min-h-11" />
          </FormField>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending} className="min-h-11">
            {pending ? 'Saving…' : 'Save allergy'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
