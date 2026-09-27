'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@proctira/ui/components';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';

import { decideConsentAction } from '../../../parent-actions';

export function ConsentDecisionButtons({
  consentId,
  status,
}: {
  consentId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDecision, setConfirmDecision] = useState<'approved' | 'denied' | null>(null);

  if (status !== 'pending') {
    return null;
  }

  function decide(next: 'approved' | 'denied') {
    startTransition(async () => {
      setError(null);
      const result = await decideConsentAction(consentId, next);
      if (result.status === 'error') {
        setError(result.message ?? 'Decision failed');
        return;
      }
      setConfirmDecision(null);
      router.refresh();
    });
  }

  return (
    <div className="mt-2 space-y-1">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          className="min-h-12"
          disabled={pending}
          onClick={() => setConfirmDecision('approved')}
        >
          Approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-12"
          disabled={pending}
          onClick={() => setConfirmDecision('denied')}
        >
          Deny
        </Button>
      </div>
      <ConfirmActionDialog
        open={confirmDecision === 'approved'}
        onOpenChange={(open) => {
          if (!open) setConfirmDecision(null);
        }}
        title="Approve this consent?"
        description="Approving records your agreement for this request. You can withdraw later only if the school allows it."
        confirmLabel="Approve"
        pending={pending}
        onConfirm={() => decide('approved')}
        testId="consent-approve-confirm"
      />
      <ConfirmActionDialog
        open={confirmDecision === 'denied'}
        onOpenChange={(open) => {
          if (!open) setConfirmDecision(null);
        }}
        title="Deny this consent?"
        description="Denying records your decision immediately. A mis-tap cannot be undone from this portal."
        confirmLabel="Deny consent"
        destructive
        pending={pending}
        onConfirm={() => decide('denied')}
        testId="consent-deny-confirm"
      />
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
