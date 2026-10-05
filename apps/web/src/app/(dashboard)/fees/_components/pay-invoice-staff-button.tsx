'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Label } from '@proctira/ui/components';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import { useHydrated } from '@/hooks/useHydrated';
import { payInvoiceStaffAction } from '@/lib/fees/actions';
import { STAFF_PAYMENT_METHODS, type StaffPaymentMethod } from '@/lib/fees/validation';
import { generateIdempotencyKey } from '@/lib/sync/idempotencyKey';

const METHOD_LABELS: Record<StaffPaymentMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  sandbox: 'Sandbox (test only)',
};

const REFERENCE_LABELS: Record<StaffPaymentMethod, string> = {
  cash: 'Receipt book number',
  upi: 'UPI transaction id',
  card: 'Card approval code',
  sandbox: 'Reference (optional)',
};

/** PRC-H058: UUID v4 (with non-randomUUID fallbacks); forwarded as the gateway Idempotency-Key. */
function newIdempotencyKey(): string {
  return generateIdempotencyKey();
}

/**
 * Staff "record payment" control (PRC-M065, PRC-M089). Records a real cash /
 * UPI / card receipt for a (possibly partial) amount with a reference (UPI
 * transaction id, card approval code or receipt-book number). Each opened
 * dialog carries one idempotency key, so a double submit or retry records the
 * payment once. The amount starts blank: the gateway does not expose the
 * remaining balance, and prefilling the invoice face amount would over-record
 * after a partial payment. Sandbox is offered only when the server enables it
 * (`sandboxEnabled`, from `isSandboxPaymentEnabled()`); the server action
 * re-checks the flag.
 */
export function PayInvoiceStaffButton({
  invoiceId,
  currency = 'INR',
  sandboxEnabled = false,
}: {
  invoiceId: string;
  currency?: string;
  /** Server-evaluated `isSandboxPaymentEnabled()`; never true in production. */
  sandboxEnabled?: boolean;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const formId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [method, setMethod] = useState<StaffPaymentMethod | ''>('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');

  const methods: StaffPaymentMethod[] = [
    ...STAFF_PAYMENT_METHODS,
    ...(sandboxEnabled ? (['sandbox'] as const) : []),
  ];

  function openDialog() {
    setError(null);
    setFieldErrors({});
    setIdempotencyKey(newIdempotencyKey());
    setConfirmOpen(true);
  }

  function onConfirmPay() {
    if (pending) return;
    // PRC-H058: minted when the dialog opens; repeated confirms reuse it.
    const key = idempotencyKey || newIdempotencyKey();
    if (key !== idempotencyKey) setIdempotencyKey(key);
    startTransition(async () => {
      setError(null);
      setFieldErrors({});
      const result = await payInvoiceStaffAction({
        invoiceId,
        method: method as StaffPaymentMethod,
        amount,
        reference: reference.trim() || undefined,
        idempotencyKey: key,
      });
      if (!result.success) {
        setError(result.error);
        const byField: Record<string, string> = {};
        for (const fe of result.fieldErrors ?? []) byField[fe.field] ??= fe.message;
        setFieldErrors(byField);
        return;
      }
      setConfirmOpen(false);
      setMethod('');
      setAmount('');
      setReference('');
      router.refresh();
    });
  }

  const methodId = `${formId}-method`;
  const amountId = `${formId}-amount`;
  const referenceId = `${formId}-reference`;
  const referenceRequired = method !== 'sandbox';

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
        description="Record money actually received for this invoice. A receipt is issued and the balance reduces by the amount entered; the invoice stays open until fully paid."
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
              onChange={(e) => setMethod(e.target.value as StaffPaymentMethod | '')}
              aria-invalid={fieldErrors['method'] ? true : undefined}
              aria-describedby={`${methodId}-hint${fieldErrors['method'] ? ` ${methodId}-error` : ''}`}
              className="flex h-9 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              data-testid="staff-pay-method"
            >
              <option value="">Select…</option>
              {methods.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABELS[m]}
                </option>
              ))}
            </select>
            <p id={`${methodId}-hint`} className="text-xs text-muted-foreground">
              Cheque payments are not supported yet.
            </p>
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
          <div className="space-y-1.5">
            <Label htmlFor={referenceId}>{method ? REFERENCE_LABELS[method] : 'Reference'}</Label>
            <Input
              id={referenceId}
              maxLength={100}
              autoComplete="off"
              required={referenceRequired}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              aria-invalid={fieldErrors['reference'] ? true : undefined}
              aria-describedby={fieldErrors['reference'] ? `${referenceId}-error` : undefined}
              data-testid="staff-pay-reference"
            />
            {fieldErrors['reference'] ? (
              <p id={`${referenceId}-error`} className="text-xs text-destructive">
                {fieldErrors['reference']}
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
