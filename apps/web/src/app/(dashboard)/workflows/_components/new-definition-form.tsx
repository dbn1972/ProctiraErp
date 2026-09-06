'use client';

/**
 * Client form for creating a workflow definition.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  Button,
  Card,
  CardContent,
  FormField,
  Input,
  Textarea,
} from '@proctira/ui/components';

import { createWorkflowDefinitionAction } from '../actions';

function parseSteps(raw: string): Array<{ name: string; approverRole: string }> {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, role] = line.split(',').map((part) => part.trim());
      return { name: name ?? '', approverRole: role ?? '' };
    })
    .filter((step) => step.name && step.approverRole);
}

export function NewDefinitionForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const name = String(fd.get('name') ?? '').trim();
    const moduleName = String(fd.get('module') ?? '').trim();
    const steps = parseSteps(String(fd.get('steps') ?? ''));

    if (!name || !moduleName || steps.length === 0) {
      setError('Name, module, and at least one step (name,role) are required.');
      return;
    }

    startTransition(async () => {
      setError(null);
      const result = await createWorkflowDefinitionAction({
        name,
        module: moduleName,
        steps,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to create definition');
        return;
      }
      router.push(
        result.definitionId
          ? `/workflows/definitions/${result.definitionId}`
          : '/workflows',
      );
      router.refresh();
    });
  }

  return (
    <Card className="max-w-[860px]">
      <CardContent className="p-6">
        <form className="space-y-5" noValidate onSubmit={onSubmit}>
          <FormField id="wf-name" label="Workflow name" required>
            <Input
              id="wf-name"
              name="name"
              placeholder="Student transfer approval"
              disabled={pending}
            />
          </FormField>
          <FormField id="wf-module" label="Module" required>
            <Input
              id="wf-module"
              name="module"
              placeholder="student"
              disabled={pending}
            />
          </FormField>
          <FormField
            id="wf-steps"
            label="Steps"
            required
            hint="One step per line: stepName,roleName"
          >
            <Textarea
              id="wf-steps"
              name="steps"
              rows={6}
              placeholder={'Principal review,PRINCIPAL\nDistrict approval,DISTRICT_ADMIN'}
              disabled={pending}
            />
          </FormField>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-3 pt-2">
            <Button asChild variant="outline" type="button">
              <Link href="/workflows">Cancel</Link>
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create definition'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
