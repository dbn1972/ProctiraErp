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

import { createHostelVisitorAction } from '../../campus-actions';
import type { Hostel } from '@/lib/api/hostel';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function NewVisitorForm({ hostels }: { hostels: Hostel[] }) {
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
    const hostelId = String(fd.get('hostelId') ?? '').trim();
    const visitorName = String(fd.get('visitorName') ?? '').trim();
    const studentId = String(fd.get('studentId') ?? '').trim();
    const visitDate = String(fd.get('visitDate') ?? '').trim();
    if (!UUID_RE.test(hostelId) || !UUID_RE.test(studentId)) {
      setError('Hostel and student must be UUID v4 values.');
      return;
    }
    if (!visitorName) {
      setError('Visitor name is required.');
      return;
    }
    if (!visitDate) {
      setError('Visit date is required.');
      return;
    }

    startTransition(async () => {
      setError(null);
      const result = await createHostelVisitorAction({
        hostelId,
        visitorName,
        studentId,
        visitDate,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to create visitor');
        return;
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  return (
    <Card className="max-w-[720px]">
      <CardHeader>
        <CardTitle className="text-base">Register visitor</CardTitle>
        <CardDescription>Creates a visitor via POST `/hostel/visitors`.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={onSubmit}
          aria-label="Create hostel visitor"
          data-testid="hostel-visitor-form"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <FormField id="visitor-hostel" label="Hostel" required>
            <select
              id="visitor-hostel"
              name="hostelId"
              className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              defaultValue=""
            >
              <option value="" disabled>
                Select hostel…
              </option>
              {hostels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({h.code})
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="visitor-name" label="Visitor name" required>
            <Input id="visitor-name" name="visitorName" className="h-11 min-h-11" />
          </FormField>
          <FormField id="visitor-student" label="Student UUID" required>
            <Input id="visitor-student" name="studentId" className="h-11 min-h-11" />
          </FormField>
          <FormField id="visitor-date" label="Visit date" required>
            <Input id="visitor-date" name="visitDate" type="date" className="h-11 min-h-11" />
          </FormField>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending || hostels.length === 0}>
              <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
              {pending ? 'Saving…' : 'Register visitor'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
