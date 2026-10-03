'use client';
/**
 * Staff "Record payment" dialog (PRC-M089).
 *
 * Replaces the one-click "Pay (sandbox)" button: staff choose the method
 * (cash / UPI), enter the amount actually collected (partial allowed) and a
 * reference (UPI transaction id or receipt-book number). A client-generated
 * idempotency key is fixed per dialog session so a double submit or retry
 * records one payment. The sandbox method is offered only when the server
 * enables it for this environment.
 */
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
import { recordStaffPaymentAction } from '@/lib/fees/actions';

type Method = 'cash' | 'upi' | 'sandbox';
type FieldKey = 'amount' | 'reference' | 'method';

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : '00000000-0000-4000-8000-000000000000'.replace(/0/g, () =>
        Math.floor(Math.random() * 16).toString(16),
      );
}

export function PayInvoiceStaffButton({
  invoiceId,
  amountCents,
  currency = 'INR',
  sandboxEnabled = false,
}: {
  invoiceId: string;
  /** Invoice face amount; the balance can be lower after partial payments. */
  amountCents?: number;
  currency?: string;
  sandboxEnabled?: boolean;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<Method>('cash');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  const [pending, startTransition] = useTransition();

  function openDialog() {
    setError(null);
    setFieldErrors({});
    setMethod('cash');
    setIdempotencyKey(newKey());
    setOpen(true);
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const fd = new FormData(event.currentTarget);
    startTransition(async () => {
      setError(null);
      const result = await recordStaffPaymentAction({
        invoiceId,
        method,
        amount: Number(String(fd.get('amount') ?? '').trim() || NaN),
        reference: String(fd.get('reference') ?? '').trim() || undefined,
        idempotencyKey,
      });
      if (!result.success) {
        const byField: Partial<Record<FieldKey, string>> = {};
        for (const fe of result.fieldErrors ?? []) {
          if (fe.field === 'amount' || fe.field === 'reference' || fe.field === 'method') {
            byField[fe.field] ??= fe.message;
          }
        }
        setFieldErrors(byField);
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const referenceLabel =
    method === 'upi' ? 'UPI transaction id' : method === 'cash' ? 'Receipt book number' : 'Reference';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        size="sm"
        disabled={!hydrated}
        data-testid="staff-pay-invoice"
        data-hydrated={hydrated ? 'true' : 'false'}
        onClick={openDialog}
      >
        Record payment
      </Button>
      <DialogContent>
        <form onSubmit={onSubmit} data-testid="staff-pay-form" noValidate>
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>
              Record money already collected from the family. A receipt is issued for the amount
              entered; the invoice stays open until fully paid.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-3">
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Method</legend>
              <div className="flex flex-wrap gap-4">
                {(
                  [
                    ['cash', 'Cash'],
                    ['upi', 'UPI'],
                    ...(sandboxEnabled ? ([['sandbox', 'Sandbox (test)']] as const) : []),
                  ] as ReadonlyArray<readonly [Method, string]>
                ).map(([value, label]) => (
                  <label key={value} className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="method"
                      value={value}
                      checked={method === value}
                      onChange={() => setMethod(value)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Cheque payments are not supported yet.
              </p>
            </fieldset>
            <FormField
              id={`pay-amount-${invoiceId}`}
              label={`Amount received (${currency})`}
              required
              error={fieldErrors.amount}
            >
              <Input
                id={`pay-amount-${invoiceId}`}
                name="amount"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                defaultValue={amountCents != null ? (amountCents / 100).toFixed(2) : ''}
                required
              />
            </FormField>
            <FormField
              id={`pay-ref-${invoiceId}`}
              label={referenceLabel}
              required={method !== 'sandbox'}
              error={fieldErrors.reference}
            >
              <Input
                id={`pay-ref-${invoiceId}`}
                name="reference"
                maxLength={100}
                autoComplete="off"
                required={method !== 'sandbox'}
              />
            </FormField>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!hydrated || pending} data-testid="staff-pay-confirm">
              {pending ? 'Recording…' : 'Record payment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
