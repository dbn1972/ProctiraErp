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
  // PRC-L240: field-level errors (aria-invalid + described-by) instead of one generic alert.
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'amount' | 'reason', string>>>({});
  const [pending, startTransition] = useTransition();
  const [pendingValues, setPendingValues] = useState<{ amount: number; reason: string } | null>(
    null,
  );

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const amount = Number(fd.get('amount') ?? 0);
    const reason = String(fd.get('reason') ?? '').trim();
    const nextErrors: typeof fieldErrors = {};
    if (!Number.isFinite(amount) || amount <= 0) {
      nextErrors.amount = 'Enter an amount greater than 0.';
    }
    if (!reason) nextErrors.reason = 'Reason is required.';
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setError(null);
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
        const byField: typeof fieldErrors = {};
        for (const fe of result.fieldErrors ?? []) {
          if (fe.field === 'amount' || fe.field === 'reason') byField[fe.field] ??= fe.message;
        }
        setFieldErrors(byField);
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
              <FormField
                id="refund-amount"
                label="Amount (INR)"
                required
                error={fieldErrors.amount}
              >
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
              <FormField id="refund-reason" label="Reason" required error={fieldErrors.reason}>
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
