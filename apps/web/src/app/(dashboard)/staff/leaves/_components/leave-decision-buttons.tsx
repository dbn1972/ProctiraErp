'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@proctira/ui/components';

import { decideStaffLeaveAction } from '../../../staff-leave-actions';

export function StaffLeaveDecisionButtons({
  leaveId,
  status,
}: {
  leaveId: string;
  status: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (status !== 'pending') {
    return (
      <p className="mt-2 text-xs text-muted-foreground" data-testid="leave-decided">
        {status}
      </p>
    );
  }

  function decide(next: 'approved' | 'rejected') {
    startTransition(async () => {
      setError(null);
      const result = await decideStaffLeaveAction(leaveId, next);
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to decide leave');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() => decide('approved')}
        data-testid="leave-approve"
      >
        Approve
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => decide('rejected')}
        data-testid="leave-reject"
      >
        Reject
      </Button>
      {error ? (
        <p className="w-full text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
