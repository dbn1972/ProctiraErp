'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@proctira/ui/components';

import { markFinePaidAction } from '../../campus-ops-actions';

export function MarkPaidButton({ fineId }: { fineId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        disabled={pending}
        data-testid={`mark-paid-${fineId}`}
        onClick={() => {
          startTransition(async () => {
            setError(null);
            setMessage(null);
            const result = await markFinePaidAction(fineId);
            if (result.status === 'error') {
              setError(result.message ?? 'Mark paid failed');
              return;
            }
            setMessage(result.message ?? 'Fine marked paid.');
            router.refresh();
          });
        }}
      >
        {pending ? 'Updating…' : 'Mark paid'}
      </Button>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="text-sm text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
