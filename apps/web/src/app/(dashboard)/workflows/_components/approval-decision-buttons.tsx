'use client';

/**
 * Approve / reject controls for a pending workflow approval.
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Check, X } from 'lucide-react';

import { Button } from '@proctira/ui/components';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';

import { decideWorkflowApprovalAction } from '../actions';

export function ApprovalDecisionButtons({ approvalId }: { approvalId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmDecision, setConfirmDecision] = useState<'approve' | 'reject' | null>(null);

  function decide(decision: 'approve' | 'reject') {
    startTransition(async () => {
      setError(null);
      const result = await decideWorkflowApprovalAction(approvalId, decision);
      if (result.status === 'error') {
        setError(result.message ?? `Failed to ${decision}`);
        return;
      }
      setConfirmDecision(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending} onClick={() => setConfirmDecision('approve')}>
          <Check className="me-1 h-4 w-4" aria-hidden="true" />
          Approve
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={pending}
          onClick={() => setConfirmDecision('reject')}
        >
          <X className="me-1 h-4 w-4" aria-hidden="true" />
          Reject
        </Button>
      </div>
      <ConfirmActionDialog
        open={confirmDecision === 'approve'}
        onOpenChange={(open) => {
          if (!open) setConfirmDecision(null);
        }}
        title="Approve this request?"
        description="Approving records your decision on this workflow step."
        confirmLabel="Approve"
        pending={pending}
        onConfirm={() => decide('approve')}
        testId="workflow-approve-confirm"
      />
      <ConfirmActionDialog
        open={confirmDecision === 'reject'}
        onOpenChange={(open) => {
          if (!open) setConfirmDecision(null);
        }}
        title="Reject this request?"
        description="Rejecting is recorded immediately. A mis-tap cannot be undone from this queue."
        confirmLabel="Reject"
        destructive
        pending={pending}
        onConfirm={() => decide('reject')}
        testId="workflow-reject-confirm"
      />
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
