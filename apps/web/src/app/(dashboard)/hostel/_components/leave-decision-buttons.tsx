'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@proctira/ui/components';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';

import { decideHostelLeaveAction } from '../../campus-actions';

export function LeaveDecisionButtons({ leaveId, status }: { leaveId: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'approved' | 'rejected' | null>(null);

  if (status !== 'pending') {
    return null;
  }

  function onConfirm() {
    if (!confirm) return;
    const next = confirm;
    startTransition(async () => {
      setError(null);
      const result = await decideHostelLeaveAction(leaveId, next);
      if (result.status === 'error') {
        setError(result.message ?? 'Decision failed');
        return;
      }
      setConfirm(null);
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
          onClick={() => setConfirm('approved')}
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
          onClick={() => setConfirm('rejected')}
          data-testid="reject-leave-button"
        >
          Reject
        </Button>
      </div>
      <ConfirmActionDialog
        open={confirm === 'approved'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Approve this leave request?"
        description="The student will be marked as approved for leave. This cannot be undone from this screen."
        confirmLabel="Approve leave"
        pending={pending}
        onConfirm={onConfirm}
        testId="hostel-leave-approve-confirm"
      />
      <ConfirmActionDialog
        open={confirm === 'rejected'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Reject this leave request?"
        description="The leave request will be rejected. Confirm only if the student should remain on campus."
        confirmLabel="Reject leave"
        destructive
        pending={pending}
        onConfirm={onConfirm}
        testId="hostel-leave-reject-confirm"
      />
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
