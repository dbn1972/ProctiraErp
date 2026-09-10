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

import { createNurseIncidentAction } from '../actions';

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function CreateNurseIncidentForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const studentId = String(fd.get('studentId') ?? '').trim();
    const institutionId = String(fd.get('institutionId') ?? '').trim();
    const incidentAt = String(fd.get('incidentAt') ?? '').trim();
    const category = String(fd.get('category') ?? '').trim();
    const severity = String(fd.get('severity') ?? 'low').trim();
    const notes = String(fd.get('notes') ?? '').trim();
    const reportedBy = String(fd.get('reportedBy') ?? '').trim();

    if (!UUID_RE.test(studentId)) {
      setError('Student ID must be a valid UUID.');
      return;
    }
    if (!incidentAt || !category || !reportedBy) {
      setError('Incident time, category, and reporter are required.');
      return;
    }

    startTransition(async () => {
      setError(null);
      const result = await createNurseIncidentAction({
        studentId,
        institutionId: institutionId || undefined,
        incidentAt: new Date(incidentAt).toISOString(),
        category,
        severity: severity as (typeof SEVERITIES)[number],
        notes: notes || undefined,
        reportedBy,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed');
        return;
      }
      router.push('/health/incidents');
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log nurse visit</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit} data-testid="create-incident-form">
          <FormField label="Student ID" htmlFor="studentId">
            <Input id="studentId" name="studentId" required className="min-h-11" />
          </FormField>
          <FormField label="Institution ID (optional)" htmlFor="institutionId">
            <Input id="institutionId" name="institutionId" className="min-h-11" />
          </FormField>
          <FormField label="Incident time" htmlFor="incidentAt">
            <Input
              id="incidentAt"
              name="incidentAt"
              type="datetime-local"
              required
              className="min-h-11"
            />
          </FormField>
          <FormField label="Category" htmlFor="category">
            <Input
              id="category"
              name="category"
              required
              placeholder="injury / illness / medication"
              className="min-h-11"
            />
          </FormField>
          <FormField label="Severity" htmlFor="severity">
            <select
              id="severity"
              name="severity"
              className="min-h-11 w-full rounded-md border border-input bg-background px-3"
              defaultValue="low"
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Reported by" htmlFor="reportedBy">
            <Input id="reportedBy" name="reportedBy" required className="min-h-11" />
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
            {pending ? 'Saving…' : 'Save incident'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
