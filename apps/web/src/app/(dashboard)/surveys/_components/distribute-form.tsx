'use client';

/**
 * Distribute survey form + remind action (ProctiraERP).
 *
 * Uses POST /surveys/distribute and POST /surveys/:id/remind.
 */
import { useFormState, useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  Button,
  FormField,
  Input,
  Textarea,
} from '@proctira/ui/components';

import {
  distributeSurveyAction,
  remindSurveyAction,
  type ActionState,
} from '../actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Distributing…' : 'Distribute'}
    </Button>
  );
}

interface Props {
  surveyId: string;
  canDistribute: boolean;
}

export function DistributeForm({ surveyId, canDistribute }: Props) {
  const bound = distributeSurveyAction.bind(null, surveyId);
  const [state, formAction] = useFormState<
    ActionState<{ distributed: number }> | null,
    FormData
  >(bound, null);

  if (!canDistribute) {
    return (
      <p className="text-sm text-muted-foreground">
        Publish the survey before distributing it to institutions.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state?.status === 'error' ? (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {state.message}
        </p>
      ) : null}
      {state?.status === 'success' ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          {state.message}
        </p>
      ) : null}

      <FormField
        id="due-date"
        label="Due date"
        hint="Optional ISO date for completion"
      >
        <Input id="due-date" name="dueDate" type="date" />
      </FormField>

      <FormField
        id="area-ids"
        label="Area IDs"
        hint="Comma-separated UUIDs — leave blank if using other filters"
      >
        <Textarea
          id="area-ids"
          name="areaIds"
          rows={2}
          placeholder="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
        />
      </FormField>

      <FormField
        id="type-ids"
        label="Institution type IDs"
        hint="Comma-separated UUIDs"
      >
        <Textarea
          id="type-ids"
          name="institutionTypeIds"
          rows={2}
          placeholder="Optional"
        />
      </FormField>

      <FormField
        id="class-ids"
        label="Classification IDs"
        hint="Comma-separated UUIDs"
      >
        <Textarea
          id="class-ids"
          name="classificationIds"
          rows={2}
          placeholder="Optional"
        />
      </FormField>

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}

export function RemindButton({ surveyId }: { surveyId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          setMessage(null);
          setError(null);
          startTransition(async () => {
            const result = await remindSurveyAction(surveyId);
            if (result.status === 'error') {
              setError(result.message ?? 'Failed');
            } else {
              setMessage(result.message ?? 'Reminders sent');
              router.refresh();
            }
          });
        }}
      >
        {pending ? 'Sending…' : 'Send reminders'}
      </Button>
      {message ? (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">{message}</p>
      ) : null}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
