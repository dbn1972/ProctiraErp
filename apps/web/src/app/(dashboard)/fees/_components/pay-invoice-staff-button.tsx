'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';
import { payInvoiceStaffAction } from '@/lib/fees/actions';

export function PayInvoiceStaffButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <Button
        type="button"
        size="sm"
        disabled={!hydrated || pending}
        data-testid="staff-pay-invoice"
        data-hydrated={hydrated ? 'true' : 'false'}
        onClick={() => {
          startTransition(async () => {
            setError(null);
            const result = await payInvoiceStaffAction(invoiceId);
            if (!result.success) {
              setError(result.error);
              return;
            }
            router.refresh();
          });
        }}
      >
        {pending ? 'Paying…' : 'Pay (sandbox)'}
      </Button>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
