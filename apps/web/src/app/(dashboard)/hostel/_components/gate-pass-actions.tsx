'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@proctira/ui/components';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';

import { decideGatePassAction, scanGatePassAction } from '../../campus-ops-actions';

export function GatePassActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'approved' | 'rejected' | null>(null);

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
              onClick={() => setConfirm('approved')}
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
              onClick={() => setConfirm('rejected')}
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
      <ConfirmActionDialog
        open={confirm === 'approved'}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title="Approve this gate pass?"
        description="The student will be allowed to leave once the pass is approved."
        confirmLabel="Approve pass"
        pending={pending}
        onConfirm={() => {
          setConfirm(null);
          run(() => decideGatePassAction(id, 'approved'));
        }}
        testId="gate-pass-approve"
      />
      <ConfirmActionDialog
        open={confirm === 'rejected'}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title="Reject this gate pass?"
        description="The student will not be cleared to leave. Confirm only if the request should be denied."
        confirmLabel="Reject pass"
        destructive
        pending={pending}
        onConfirm={() => {
          setConfirm(null);
          run(() => decideGatePassAction(id, 'rejected'));
        }}
        testId="gate-pass-reject"
      />
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
