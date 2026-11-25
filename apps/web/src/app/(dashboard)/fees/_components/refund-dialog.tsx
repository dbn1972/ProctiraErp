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
import type { RefundablePayment } from '@/lib/api/fees';
import { listRefundablePaymentsAction, refundInvoiceAction } from '@/lib/fees/actions';
import { generateIdempotencyKey } from '@/lib/sync/idempotencyKey';

function paymentLabel(payment: RefundablePayment): string {
  const paid = (payment.amountCents / 100).toFixed(2);
  const left = (payment.refundableCents / 100).toFixed(2);
  return `${payment.method} · ${payment.paidAt.slice(0, 10)} · INR ${paid} (refundable ${left})`;
}

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
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<'paymentId' | 'amount' | 'reason', string>>
  >({});
  const [pending, startTransition] = useTransition();
  // PRC-M090: a refund targets one payment of this invoice, loaded when the dialog opens.
  const [payments, setPayments] = useState<RefundablePayment[] | null>(null);
  const [paymentId, setPaymentId] = useState('');
  // PRC-H058: one Idempotency-Key per submitted refund; a double-confirm reuses it.
  const [pendingValues, setPendingValues] = useState<{
    paymentId: string;
    amount: number;
    reason: string;
    idempotencyKey: string;
  } | null>(null);

  const refundable = (payments ?? []).filter((p) => p.refundableCents > 0);
  const selected = refundable.find((p) => p.paymentId === paymentId);

  function openDialog() {
    setOpen(true);
    setPayments(null);
    setError(null);
    startTransition(async () => {
      const result = await listRefundablePaymentsAction(invoiceId);
      if (!result.success) {
        setPayments([]);
        setError(result.error);
        return;
      }
      setPayments(result.data);
      setPaymentId(result.data.find((p) => p.refundableCents > 0)?.paymentId ?? '');
    });
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const amount = Number(fd.get('amount') ?? 0);
    const reason = String(fd.get('reason') ?? '').trim();
    const nextErrors: typeof fieldErrors = {};
    if (!selected) nextErrors.paymentId = 'Choose the payment to refund.';
    if (!Number.isFinite(amount) || amount <= 0) {
      nextErrors.amount = 'Enter an amount greater than 0.';
    }
    if (!reason) nextErrors.reason = 'Reason is required.';
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !selected) {
      setError(null);
      return;
    }
    setError(null);
    setPendingValues({
      paymentId: selected.paymentId,
      amount,
      reason,
      idempotencyKey: generateIdempotencyKey(),
    });
    setConfirmOpen(true);
  }

  function onConfirmRefund() {
    if (!pendingValues) return;
    const values = pendingValues;
    startTransition(async () => {
      setError(null);
      const result = await refundInvoiceAction({
        invoiceId,
        paymentId: values.paymentId,
        amount: values.amount,
        reason: values.reason,
        idempotencyKey: values.idempotencyKey,
      });
      if (!result.success) {
        const byField: typeof fieldErrors = {};
        for (const fe of result.fieldErrors ?? []) {
          if (fe.field === 'paymentId' || fe.field === 'amount' || fe.field === 'reason') {
            byField[fe.field] ??= fe.message;
          }
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
          onClick={openDialog}
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
                Choose the payment, then enter the refund amount and reason. A refund cannot exceed
                what is still refundable on that payment. Nothing is posted until you confirm on the
                next step.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-3">
              <FormField id="refund-payment" label="Payment" required error={fieldErrors.paymentId}>
                <select
                  id="refund-payment"
                  name="paymentId"
                  className="flex h-10 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={paymentId}
                  onChange={(event) => setPaymentId(event.target.value)}
                  disabled={payments === null || refundable.length === 0}
                  required
                >
                  {payments === null ? <option value="">Loading payments…</option> : null}
                  {payments !== null && refundable.length === 0 ? (
                    <option value="">No refundable payment on this invoice</option>
                  ) : null}
                  {refundable.map((payment) => (
                    <option key={payment.paymentId} value={payment.paymentId}>
                      {paymentLabel(payment)}
                    </option>
                  ))}
                </select>
              </FormField>
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
              <Button
                type="submit"
                disabled={!hydrated || pending || !selected}
                data-testid="submit-refund"
              >
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
