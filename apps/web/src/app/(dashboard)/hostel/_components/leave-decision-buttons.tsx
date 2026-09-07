'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@proctira/ui/components';

import { decideHostelLeaveAction } from '../../campus-actions';

export function LeaveDecisionButtons({ leaveId, status }: { leaveId: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (status !== 'pending') {
    return null;
  }

  function decide(next: 'approved' | 'rejected') {
    startTransition(async () => {
      setError(null);
      const result = await decideHostelLeaveAction(leaveId, next);
      if (result.status === 'error') {
        setError(result.message ?? 'Decision failed');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-2 space-y-1">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          className="min-h-11"
          disabled={pending}
          onClick={() => decide('approved')}
          data-testid="approve-leave-button"
        >
          Approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-11"
          disabled={pending}
          onClick={() => decide('rejected')}
          data-testid="reject-leave-button"
        >
          Reject
        </Button>
      </div>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
