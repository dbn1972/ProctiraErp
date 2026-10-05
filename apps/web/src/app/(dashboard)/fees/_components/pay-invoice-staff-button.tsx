'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button, Input, Label } from '@proctira/ui/components';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import { useHydrated } from '@/hooks/useHydrated';
import { payInvoiceStaffAction } from '@/lib/fees/actions';
import { isSandboxPaymentEnabled, STAFF_PAYMENT_METHODS } from '@/lib/fees/validation';
import { generateIdempotencyKey } from '@/lib/sync/idempotencyKey';

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  sandbox: 'Sandbox (test only)',
};

/** PRC-H058: UUID v4 (with non-randomUUID fallbacks); forwarded as the gateway Idempotency-Key. */
function newIdempotencyKey(): string {
  return generateIdempotencyKey();
}

/**
 * Staff "record payment" control (PRC-M065). Records a real cash / UPI / card
 * receipt for a (possibly partial) amount. Each opened dialog carries one
 * idempotency key so a double-submit cannot record the payment twice.
 */
export function PayInvoiceStaffButton({
  invoiceId,
  currency = 'INR',
}: {
  invoiceId: string;
  currency?: string;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const formId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [method, setMethod] = useState<string>('');
  const [amount, setAmount] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');

  const methods: string[] = [
    ...STAFF_PAYMENT_METHODS,
    ...(isSandboxPaymentEnabled() ? ['sandbox'] : []),
  ];

  function openDialog() {
    setError(null);
    setFieldErrors({});
    setIdempotencyKey(newIdempotencyKey());
    setConfirmOpen(true);
  }

  function onConfirmPay() {
    // PRC-H058: minted when the dialog opens; repeated confirms reuse it.
    const key = idempotencyKey || newIdempotencyKey();
    if (key !== idempotencyKey) setIdempotencyKey(key);
    startTransition(async () => {
      setError(null);
      setFieldErrors({});
      const result = await payInvoiceStaffAction({
        invoiceId,
        method: method as 'cash',
        amount,
        idempotencyKey: key,
      });
      if (!result.success) {
        setError(result.error);
        setFieldErrors(
          Object.fromEntries((result.fieldErrors ?? []).map((f) => [f.field, f.message])),
        );
        return;
      }
      setConfirmOpen(false);
      setMethod('');
      setAmount('');
      router.refresh();
    });
  }

  const methodId = `${formId}-method`;
  const amountId = `${formId}-amount`;

  return (
    <div>
      <Button
        type="button"
        size="sm"
        disabled={!hydrated || pending}
        data-testid="staff-pay-invoice"
        data-hydrated={hydrated ? 'true' : 'false'}
        onClick={openDialog}
      >
        {pending ? 'Recording…' : 'Record payment'}
      </Button>
      <ConfirmActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Record payment received"
        description="Record money actually received for this invoice. A receipt is issued and the balance reduces by the amount entered."
        confirmLabel="Record payment"
        pending={pending}
        onConfirm={onConfirmPay}
        testId="staff-pay-confirm"
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={methodId}>Payment method</Label>
            <select
              id={methodId}
              required
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              aria-invalid={fieldErrors['method'] ? true : undefined}
              aria-describedby={fieldErrors['method'] ? `${methodId}-error` : undefined}
              className="flex h-9 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              data-testid="staff-pay-method"
            >
              <option value="">Select…</option>
              {methods.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABELS[m] ?? m}
                </option>
              ))}
            </select>
            {fieldErrors['method'] ? (
              <p id={`${methodId}-error`} className="text-xs text-destructive">
                {fieldErrors['method']}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={amountId}>Amount received ({currency})</Label>
            <Input
              id={amountId}
              inputMode="decimal"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={fieldErrors['amount'] ? true : undefined}
              aria-describedby={fieldErrors['amount'] ? `${amountId}-error` : undefined}
              data-testid="staff-pay-amount"
            />
            {fieldErrors['amount'] ? (
              <p id={`${amountId}-error`} className="text-xs text-destructive">
                {fieldErrors['amount']}
              </p>
            ) : null}
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </ConfirmActionDialog>
    </div>
  );
}
