'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CreditCard } from 'lucide-react';

import { Button } from '@proctira/ui/components';

import { payInvoiceAction } from '../../../parent-actions';

export function PayInvoiceButton({ invoiceId, status }: { invoiceId: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (status !== 'open' && status !== 'pending') {
    return null;
  }

  function onPay() {
    startTransition(async () => {
      setError(null);
      const result = await payInvoiceAction(invoiceId);
      if (result.status === 'error') {
        setError(result.message ?? 'Payment failed');
        return;
      }
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
        onClick={onPay}
        data-testid="parent-pay-button"
      >
        <CreditCard className="me-1.5 h-4 w-4" aria-hidden="true" />
        {pending ? 'Processing…' : 'Pay (sandbox)'}
      </Button>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
