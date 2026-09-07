'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@proctira/ui/components';

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
          onClick={() => decide('approved')}
        >
          Approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-12"
          disabled={pending}
          onClick={() => decide('denied')}
        >
          Deny
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
