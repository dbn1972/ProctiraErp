'use client';

/**
 * Publish / close survey status actions (ProctiraERP).
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@proctira/ui/components';
import type { SurveyStatus } from '@/lib/api/surveys';

import { closeSurveyAction, publishSurveyAction } from '../actions';

interface Props {
  surveyId: string;
  status: SurveyStatus;
}

export function PublishCloseButtons({ surveyId, status }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(
    action: (id: string) => Promise<{ status: string; message?: string }>,
  ) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await action(surveyId);
      if (result.status === 'error') {
        setError(result.message ?? 'Action failed');
      } else {
        setMessage(result.message ?? 'Done');
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      {status === 'draft' ? (
        <Button
          className="w-full"
          size="sm"
          disabled={pending}
          onClick={() => run(publishSurveyAction)}
        >
          Publish survey
        </Button>
      ) : null}
      {status === 'published' ? (
        <Button
          className="w-full"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(closeSurveyAction)}
        >
          Close survey
        </Button>
      ) : null}
      {status === 'closed' ? (
        <p className="text-sm text-muted-foreground">
          This survey is closed and can no longer be edited or distributed.
        </p>
      ) : null}
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
