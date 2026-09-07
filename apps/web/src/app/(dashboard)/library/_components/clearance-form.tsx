'use client';

import { useState, useTransition } from 'react';
import { Search } from 'lucide-react';

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

import { checkLibraryClearanceAction } from '../../campus-actions';

export function LibraryClearanceForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const studentId = String(fd.get('studentId') ?? '').trim();
    if (!studentId) {
      setError('Student ID is required.');
      return;
    }

    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await checkLibraryClearanceAction(studentId);
      if (result.status === 'error') {
        setError(result.message ?? 'Clearance check failed');
        return;
      }
      setMessage(result.message ?? null);
    });
  }

  return (
    <Card className="max-w-[640px]">
      <CardHeader>
        <CardTitle className="text-base">Transfer clearance</CardTitle>
        <CardDescription>
          Student transfer checklist hook — clear when no open loans remain.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={onSubmit}
          aria-label="Library clearance check"
          data-testid="library-clearance-form"
        >
          <FormField id="clearance-student" label="Student UUID" required>
            <Input
              id="clearance-student"
              name="studentId"
              placeholder="Student id"
              className="h-11 min-h-11"
            />
          </FormField>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {message ? (
            <p
              className="text-sm text-foreground"
              role="status"
              data-testid="library-clearance-result"
            >
              {message}
            </p>
          ) : null}
          <Button type="submit" disabled={pending} className="min-h-11">
            <Search className="me-1.5 h-4 w-4" aria-hidden="true" />
            {pending ? 'Checking…' : 'Check clearance'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
