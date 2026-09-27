'use client';

/**
 * Retry failed scholarship disbursements via PUT status → scheduled.
 * UX_FINDINGS: re-submits every failed payment — confirm bank details first.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@proctira/ui/components';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';

import { retryFailedDisbursementsAction } from '../actions';

interface RetryFailedTransfersButtonProps {
  failedIds: string[];
}

export function RetryFailedTransfersButton({ failedIds }: RetryFailedTransfersButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const disabled = failedIds.length === 0 || isPending;
  const count = failedIds.length;

  return (
    <div className="flex flex-col items-stretch gap-1 sm:items-end">
      <Button
        variant="destructive"
        size="sm"
        className="shrink-0"
        type="button"
        disabled={disabled}
        title={
          failedIds.length === 0 ? 'No failed transfers' : 'Re-queue failed transfers as scheduled'
        }
        onClick={() => setConfirmOpen(true)}
      >
        {isPending ? 'Retrying…' : 'Retry failed transfers'}
      </Button>
      <ConfirmActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Retry ${count} failed ${count === 1 ? 'transfer' : 'transfers'}?`}
        description="Confirm bank details before reprocessing. Every failed payment in this batch will be re-queued as scheduled."
        confirmLabel="Retry transfers"
        destructive
        pending={isPending}
        onConfirm={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await retryFailedDisbursementsAction(failedIds);
            setMessage(result.message ?? null);
            if (result.status === 'success') {
              setConfirmOpen(false);
              router.refresh();
            }
          });
        }}
        testId="retry-transfers-confirm"
      />
      {message ? (
        <p className="text-xs opacity-90" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
