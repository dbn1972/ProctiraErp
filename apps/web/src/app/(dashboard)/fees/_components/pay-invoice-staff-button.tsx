'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@proctira/ui/components';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import { useHydrated } from '@/hooks/useHydrated';
import { payInvoiceStaffAction } from '@/lib/fees/actions';

export function PayInvoiceStaffButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function onConfirmPay() {
    startTransition(async () => {
      setError(null);
      const result = await payInvoiceStaffAction(invoiceId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    });
  }

  return (
    <div>
      <Button
        type="button"
        size="sm"
        disabled={!hydrated || pending}
        data-testid="staff-pay-invoice"
        data-hydrated={hydrated ? 'true' : 'false'}
        onClick={() => setConfirmOpen(true)}
      >
        {pending ? 'Paying…' : 'Pay (sandbox)'}
      </Button>
      <ConfirmActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Record sandbox payment?"
        description="This marks the invoice as paid and creates a receipt. Confirm the family has paid before continuing."
        confirmLabel="Record payment"
        pending={pending}
        onConfirm={onConfirmPay}
        testId="staff-pay-confirm"
      />
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
