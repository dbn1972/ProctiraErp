'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button, FormField, Input } from '@proctira/ui/components';

import { createPipelineAction } from '../actions';

export function CreatePipelineForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const name = String(fd.get('name') ?? '').trim();
    const sourceType = String(fd.get('sourceType') ?? 'csv') as 'csv' | 'rest_api';
    if (!name) {
      setError('Name is required');
      return;
    }
    startTransition(async () => {
      setError(null);
      const result = await createPipelineAction({ name, sourceType });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed');
        return;
      }
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-wrap items-end gap-3"
      data-testid="create-pipeline-form"
    >
      <FormField label="Pipeline name" htmlFor="pipeline-name">
        <Input id="pipeline-name" name="name" required className="min-h-11 min-w-[200px]" />
      </FormField>
      <FormField label="Source" htmlFor="sourceType">
        <select
          id="sourceType"
          name="sourceType"
          className="min-h-11 rounded-md border border-input bg-background px-3"
          defaultValue="csv"
        >
          <option value="csv">CSV</option>
          <option value="rest_api">REST API</option>
        </select>
      </FormField>
      <Button type="submit" disabled={pending} className="min-h-11">
        {pending ? 'Creating…' : 'Create pipeline'}
      </Button>
      {error ? (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
