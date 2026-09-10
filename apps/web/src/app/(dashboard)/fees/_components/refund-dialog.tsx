'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
} from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';
import { refundInvoiceAction } from '@/lib/fees/actions';

export function RefundDialog({
  invoiceId,
  amountCents,
}: {
  invoiceId: string;
  amountCents: number;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    startTransition(async () => {
      setError(null);
      const result = await refundInvoiceAction({
        invoiceId,
        amount: Number(fd.get('amount') ?? 0),
        reason: String(fd.get('reason') ?? ''),
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!hydrated}
        data-testid="open-refund"
        data-hydrated={hydrated ? 'true' : 'false'}
        onClick={() => setOpen(true)}
      >
        Refund
      </Button>
      <DialogContent>
        <form
          onSubmit={onSubmit}
          data-testid="refund-form"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <DialogHeader>
            <DialogTitle>Record refund</DialogTitle>
            <DialogDescription>
              Cannot exceed the amount already paid on this invoice.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-3">
            <FormField id="refund-amount" label="Amount (INR)" required>
              <Input
                id="refund-amount"
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                defaultValue={(amountCents / 100).toFixed(2)}
              />
            </FormField>
            <FormField id="refund-reason" label="Reason" required>
              <Input id="refund-reason" name="reason" required />
            </FormField>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!hydrated || pending} data-testid="submit-refund">
              {pending ? 'Saving…' : 'Refund'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
