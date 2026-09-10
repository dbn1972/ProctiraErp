'use client';

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

import { createThreadAction } from '../../../parent-actions';

export function CreateThreadForm({ studentIds }: { studentIds: string[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const studentId = String(fd.get('studentId') ?? '').trim();
    const subject = String(fd.get('subject') ?? '').trim();
    const body = String(fd.get('body') ?? '').trim();
    if (!studentId || !subject || !body) {
      setError('Student, subject, and message are required.');
      return;
    }

    startTransition(async () => {
      setError(null);
      const result = await createThreadAction({ studentId, subject, body });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to create thread');
        return;
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
      if (result.id) {
        router.push(`/parent/messages/${result.id}`);
      }
    });
  }

  return (
    <Card className="max-w-[720px]">
      <CardHeader>
        <CardTitle className="text-base">New message</CardTitle>
        <CardDescription>Start a conversation with school staff.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={onSubmit}
          aria-label="Create message thread"
        >
          <FormField id="thread-student" label="Student ID" required>
            {studentIds.length > 0 ? (
              <select
                id="thread-student"
                name="studentId"
                className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                defaultValue={studentIds[0]}
              >
                {studentIds.map((id) => (
                  <option key={id} value={id}>
                    {id.slice(0, 8)}…
                  </option>
                ))}
              </select>
            ) : (
              <Input id="thread-student" name="studentId" className="h-11 min-h-11" />
            )}
          </FormField>
          <FormField id="thread-subject" label="Subject" required>
            <Input id="thread-subject" name="subject" className="h-11 min-h-11" />
          </FormField>
          <FormField id="thread-body" label="Message" required>
            <Textarea id="thread-body" name="body" rows={4} className="min-h-[96px]" />
          </FormField>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending} className="min-h-12">
              <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
              {pending ? 'Sending…' : 'Send message'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
