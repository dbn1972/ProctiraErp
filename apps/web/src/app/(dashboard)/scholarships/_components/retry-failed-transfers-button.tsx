'use client';

/**
 * Retry failed scholarship disbursements via PUT status → scheduled.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@proctira/ui/components';

import { retryFailedDisbursementsAction } from '../actions';

interface RetryFailedTransfersButtonProps {
  failedIds: string[];
}

export function RetryFailedTransfersButton({ failedIds }: RetryFailedTransfersButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const disabled = failedIds.length === 0 || isPending;

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
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await retryFailedDisbursementsAction(failedIds);
            setMessage(result.message ?? null);
            if (result.status === 'success') router.refresh();
          });
        }}
      >
        {isPending ? 'Retrying…' : 'Retry failed transfers'}
      </Button>
      {message ? (
        <p className="text-xs opacity-90" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
