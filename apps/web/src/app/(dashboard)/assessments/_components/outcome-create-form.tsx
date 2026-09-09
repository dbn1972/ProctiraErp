'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { createOutcomeAction } from '@/app/(dashboard)/assessments/actions';
import { useHydrated } from '@/hooks/useHydrated';
import { Button, Input, Label, Textarea } from '@proctira/ui/components';

export function OutcomeCreateForm({
  subjects,
  defaultSubjectId,
}: {
  subjects: Array<{ id: string; name: string; code: string }>;
  defaultSubjectId: string;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2"
      data-testid="outcome-create-form"
      data-hydrated={hydrated ? 'true' : 'false'}
      onSubmit={(event) => {
        event.preventDefault();
        const fd = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await createOutcomeAction({
            subjectId: String(fd.get('subjectId') ?? ''),
            name: String(fd.get('name') ?? ''),
            code: String(fd.get('code') ?? ''),
            description: String(fd.get('description') ?? ''),
          });
          if (result.status === 'error') {
            setError(result.message ?? 'Unable to save outcome');
            return;
          }
          event.currentTarget.reset();
          router.refresh();
        });
      }}
    >
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="outcome-subject">Subject</Label>
        <select
          id="outcome-subject"
          name="subjectId"
          required
          defaultValue={defaultSubjectId}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          data-testid="outcome-subject"
        >
          <option value="">Select subject</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="outcome-code">Code</Label>
        <Input id="outcome-code" name="code" required maxLength={50} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="outcome-name">Name</Label>
        <Input id="outcome-name" name="name" required maxLength={255} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="outcome-description">Description</Label>
        <Textarea id="outcome-description" name="description" rows={2} maxLength={1000} />
      </div>
      <Button
        type="submit"
        size="sm"
        disabled={pending || subjects.length === 0}
        data-testid="add-outcome"
      >
        {pending ? 'Saving…' : 'Add outcome'}
      </Button>
      {error ? (
        <p className="text-sm text-destructive sm:col-span-2" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
