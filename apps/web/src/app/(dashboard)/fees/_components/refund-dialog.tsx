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
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [pendingValues, setPendingValues] = useState<{ amount: number; reason: string } | null>(
    null,
  );

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const amount = Number(fd.get('amount') ?? 0);
    const reason = String(fd.get('reason') ?? '').trim();
    if (!Number.isFinite(amount) || amount <= 0 || !reason) {
      setError('Amount and reason are required.');
      return;
    }
    setError(null);
    setPendingValues({ amount, reason });
    setConfirmOpen(true);
  }

  function onConfirmRefund() {
    if (!pendingValues) return;
    const values = pendingValues;
    startTransition(async () => {
      setError(null);
      const result = await refundInvoiceAction({
        invoiceId,
        amount: values.amount,
        reason: values.reason,
      });
      if (!result.success) {
        setError(result.error);
        setConfirmOpen(false);
        return;
      }
      setConfirmOpen(false);
      setPendingValues(null);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
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
                Enter the refund amount and reason. Cannot exceed the amount already paid on this
                invoice. Nothing is posted until you confirm on the next step.
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
                  required
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
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!hydrated || pending} data-testid="submit-refund">
                Review refund
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Record this refund?"
        description={
          pendingValues
            ? `This posts INR ${pendingValues.amount.toFixed(2)} back to the payer. Reason: ${pendingValues.reason}`
            : 'This posts the refund to the fee ledger.'
        }
        confirmLabel="Record refund"
        destructive
        pending={pending}
        onConfirm={onConfirmRefund}
        testId="refund-confirm"
      />
    </>
  );
}
