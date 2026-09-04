'use client';

/**
 * Pause / Resume control for a workflow definition.
 *
 * PUT /workflows/:id with `{ paused, status }`.
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Loader2, Pause, Play } from 'lucide-react';

import { Button } from '@proctira/ui/components';
import { setWorkflowPaused } from '@/lib/api/workflows-browser';

interface PauseResumeButtonProps {
  definitionId: string;
  paused: boolean;
}

export function PauseResumeButton({ definitionId, paused }: PauseResumeButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onClick() {
    setError(null);
    const nextPaused = !paused;
    startTransition(async () => {
      try {
        await setWorkflowPaused(definitionId, nextPaused);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update workflow');
      }
    });
  }

  return (
    <div className="flex flex-col items-stretch gap-1 sm:items-end">
      <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={onClick}
        disabled={isPending}
        aria-pressed={paused}
      >
        {isPending ? (
          <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
        ) : paused ? (
          <Play className="me-1.5 h-4 w-4" aria-hidden="true" />
        ) : (
          <Pause className="me-1.5 h-4 w-4" aria-hidden="true" />
        )}
        {paused ? 'Resume' : 'Pause'}
      </Button>
      {error ? (
        <p className="max-w-[220px] text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
