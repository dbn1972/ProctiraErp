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

import { createQualificationAction } from '../hr-actions';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function NewQualificationForm() {
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
      const result = await createQualificationAction({
        staffId,
        degree: String(fd.get('degree') ?? '').trim(),
        institution: String(fd.get('institution') ?? '').trim(),
        year: Number(fd.get('year')),
        documentRef: String(fd.get('documentRef') ?? '').trim() || undefined,
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
        <CardTitle className="text-base">New qualification</CardTitle>
        <CardDescription>Degree, institution, year, optional document reference.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={onSubmit}
          className="grid gap-3 sm:grid-cols-2"
          data-testid="staff-qualification-form"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <FormField id="qual-staff" label="Staff UUID" required className="sm:col-span-2">
            <Input id="qual-staff" name="staffId" required disabled={!hydrated || pending} />
          </FormField>
          <FormField id="qual-degree" label="Degree" required>
            <Input id="qual-degree" name="degree" required disabled={!hydrated || pending} />
          </FormField>
          <FormField id="qual-inst" label="Institution" required>
            <Input id="qual-inst" name="institution" required disabled={!hydrated || pending} />
          </FormField>
          <FormField id="qual-year" label="Year" required>
            <Input
              id="qual-year"
              name="year"
              type="number"
              required
              disabled={!hydrated || pending}
            />
          </FormField>
          <FormField id="qual-doc" label="Document ref">
            <Input id="qual-doc" name="documentRef" disabled={!hydrated || pending} />
          </FormField>
          {error ? (
            <p className="sm:col-span-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={!hydrated || pending}>
              {pending ? 'Saving…' : 'Save qualification'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
