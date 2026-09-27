'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CreditCard } from 'lucide-react';

import { Button } from '@proctira/ui/components';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';

import { payInvoiceAction } from '../../../parent-actions';

export function PayInvoiceButton({ invoiceId, status }: { invoiceId: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (status !== 'open' && status !== 'pending') {
    return null;
  }

  function onConfirmPay() {
    startTransition(async () => {
      setError(null);
      const result = await payInvoiceAction(invoiceId);
      if (result.status === 'error') {
        setError(result.message ?? 'Payment failed');
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="mt-2 space-y-1">
      <Button
        type="button"
        size="sm"
        className="min-h-12"
        disabled={pending}
        onClick={() => setConfirmOpen(true)}
        data-testid="parent-pay-button"
      >
        <CreditCard className="me-1.5 h-4 w-4" aria-hidden="true" />
        {pending ? 'Processing…' : 'Pay (sandbox)'}
      </Button>
      <ConfirmActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Pay this invoice?"
        description="Sandbox payment will mark this invoice paid and create a receipt. Confirm the amount before continuing."
        confirmLabel="Pay now"
        pending={pending}
        onConfirm={onConfirmPay}
        testId="parent-pay-confirm"
      />
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
