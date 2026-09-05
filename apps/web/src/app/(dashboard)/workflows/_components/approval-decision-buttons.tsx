'use client';

/**
 * Approve / reject controls for a pending workflow approval.
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Check, X } from 'lucide-react';

import { Button } from '@proctira/ui/components';

import { decideWorkflowApprovalAction } from '../actions';

export function ApprovalDecisionButtons({ approvalId }: { approvalId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(decision: 'approve' | 'reject') {
    startTransition(async () => {
      setError(null);
      const result = await decideWorkflowApprovalAction(approvalId, decision);
      if (result.status === 'error') {
        setError(result.message ?? `Failed to ${decision}`);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending} onClick={() => decide('approve')}>
          <Check className="me-1 h-4 w-4" aria-hidden="true" />
          Approve
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={pending}
          onClick={() => decide('reject')}
        >
          <X className="me-1 h-4 w-4" aria-hidden="true" />
          Reject
        </Button>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
