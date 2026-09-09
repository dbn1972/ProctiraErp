'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@proctira/ui/components';

import { decideGatePassAction, scanGatePassAction } from '../../campus-ops-actions';

export function GatePassActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ status: string; message?: string }>) {
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (result.status === 'error') {
        setError(result.message ?? 'Update failed');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-2 space-y-1">
      <div className="flex flex-wrap gap-2">
        {status === 'pending' ? (
          <>
            <Button
              type="button"
              size="sm"
              className="min-h-11"
              disabled={pending}
              data-testid={`gate-approve-${id}`}
              onClick={() => run(() => decideGatePassAction(id, 'approved'))}
            >
              Approve
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11"
              disabled={pending}
              data-testid={`gate-reject-${id}`}
              onClick={() => run(() => decideGatePassAction(id, 'rejected'))}
            >
              Reject
            </Button>
          </>
        ) : null}
        {status === 'approved' ? (
          <Button
            type="button"
            size="sm"
            className="min-h-11"
            disabled={pending}
            data-testid={`gate-out-${id}`}
            onClick={() => run(() => scanGatePassAction(id, 'out'))}
          >
            Mark out
          </Button>
        ) : null}
        {status === 'out' ? (
          <Button
            type="button"
            size="sm"
            className="min-h-11"
            disabled={pending}
            data-testid={`gate-in-${id}`}
            onClick={() => run(() => scanGatePassAction(id, 'in'))}
          >
            Mark in
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
