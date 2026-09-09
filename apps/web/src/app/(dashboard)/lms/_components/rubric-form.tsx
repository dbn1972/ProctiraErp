'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button, Input, Label } from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';

import { createRubricAction } from '../depth-actions';

export function RubricForm() {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createRubricAction({
        scope: 'school',
        institutionId: String(form.get('institutionId') ?? ''),
        name: String(form.get('name') ?? ''),
        subject: String(form.get('subject') ?? ''),
        criterionName: String(form.get('criterionName') ?? ''),
        maxPoints: Number(form.get('maxPoints') ?? 4),
      });
      setMessage(result.status === 'success' ? 'Rubric saved.' : (result.message ?? 'Failed'));
      if (result.status === 'success') router.refresh();
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-3 sm:grid-cols-2"
      data-testid="lms-rubric-form"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <div className="space-y-1">
        <Label htmlFor="rubric-name">Name</Label>
        <Input id="rubric-name" name="name" required className="h-11" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="rubric-school">School ID</Label>
        <Input id="rubric-school" name="institutionId" required className="h-11" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="rubric-criterion">First criterion</Label>
        <Input id="rubric-criterion" name="criterionName" required className="h-11" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="rubric-points">Max points</Label>
        <Input id="rubric-points" name="maxPoints" type="number" min={1} defaultValue={4} className="h-11" />
      </div>
      <Button type="submit" disabled={pending} aria-busy={pending}>
        Create rubric
      </Button>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}
