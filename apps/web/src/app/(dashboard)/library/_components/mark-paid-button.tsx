'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
} from '@proctira/ui/components';

import { markFinePaidAction } from '../../campus-ops-actions';

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
] as const;

type PaymentMethod = (typeof PAYMENT_METHODS)[number]['value'];

/**
 * PRC-H025 — collect the real payment method + receipt reference in an
 * accessible confirm dialog and pass them to the backend, instead of settling
 * the fee-ledger invoice with a synthetic `library-fine:<id>` reference.
 *
 * Accessibility: Radix Dialog provides the focus trap, initial focus and focus
 * restore on close; inputs are associated with visible <Label htmlFor> targets;
 * the confirm button is disabled until a reference is entered.
 */
export function MarkPaidButton({ fineId }: { fineId: string }) {
  const router = useRouter();
  const methodId = useId();
  const referenceId = useId();
  const [open, setOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const trimmedReference = reference.trim();
  const canSubmit = trimmedReference.length > 0 && !pending;

  function confirm() {
    if (!canSubmit) return;
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await markFinePaidAction(fineId, {
        paymentMethod,
        reference: trimmedReference,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Mark paid failed');
        return;
      }
      setMessage(result.message ?? 'Fine marked paid.');
      setOpen(false);
      setReference('');
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            data-testid={`mark-paid-${fineId}`}
          >
            Mark paid
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record fine payment</DialogTitle>
            <DialogDescription>
              Enter how the fine was paid and the receipt reference. This settles the
              student&rsquo;s fee invoice.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor={methodId}>Payment method</Label>
              <select
                id={methodId}
                className="flex h-9 min-h-11 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                value={paymentMethod}
                disabled={pending}
                onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}
              >
                {PAYMENT_METHODS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={referenceId}>Receipt / transaction reference</Label>
              <Input
                id={referenceId}
                value={reference}
                disabled={pending}
                maxLength={128}
                autoComplete="off"
                placeholder="e.g. receipt number"
                onChange={(event) => setReference(event.target.value)}
                aria-describedby={error ? `${referenceId}-error` : undefined}
                aria-invalid={error ? true : undefined}
              />
            </div>

            {error ? (
              <p id={`${referenceId}-error`} className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={!canSubmit}
              data-testid={`confirm-mark-paid-${fineId}`}
              onClick={confirm}
            >
              {pending ? 'Updating…' : 'Confirm payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {message ? (
        <p className="text-sm text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
