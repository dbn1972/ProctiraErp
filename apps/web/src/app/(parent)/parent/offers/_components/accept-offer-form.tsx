'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button, FormField, Input } from '@proctira/ui/components';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import { useHydrated } from '@/hooks/useHydrated';
import type { ParentAdmissionOffer } from '@/lib/api/parent-portal';
import { acceptGuardianOfferAction } from '../../../parent-actions';

function formatFee(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'INR',
    }).format(amount);
  } catch {
    return `${amount} ${currency || 'INR'}`;
  }
}

export function AcceptOfferForm({ offer }: { offer: ParentAdmissionOffer }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [paymentRef, setPaymentRef] = useState('SANDBOX-PAY');

  if (offer.status !== 'sent') {
    return null;
  }

  function onConfirmAccept() {
    startTransition(async () => {
      setError(null);
      const result = await acceptGuardianOfferAction({
        offerId: offer.id,
        paymentRef: paymentRef.trim(),
        offerFeeInvoiceId: offer.offerFeeInvoiceId ?? undefined,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Accept failed');
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    });
  }

  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2"
      data-testid="parent-accept-offer-form"
      data-hydrated={hydrated ? 'true' : 'false'}
      onSubmit={(event) => {
        event.preventDefault();
        const fd = new FormData(event.currentTarget);
        setPaymentRef(String(fd.get('paymentRef') ?? '').trim());
        setConfirmOpen(true);
      }}
    >
      <FormField id={`pay-ref-${offer.id}`} label="Payment reference">
        <Input
          id={`pay-ref-${offer.id}`}
          name="paymentRef"
          required
          value={paymentRef}
          onChange={(event) => setPaymentRef(event.target.value)}
          disabled={!hydrated || pending}
          data-testid="parent-payment-ref"
          className="min-h-12"
        />
      </FormField>
      <Button
        type="submit"
        size="sm"
        className="min-h-12"
        disabled={!hydrated || pending}
        data-testid="parent-accept-offer"
      >
        {pending ? 'Accepting…' : 'Pay (sandbox) & accept'}
      </Button>
      <ConfirmActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Accept this offer?"
        description={`This enrols the student and records payment ${formatFee(offer.feeAmount, offer.feeCurrency)}. Acceptance cannot be undone from the parent portal.`}
        confirmLabel="Accept & enrol"
        pending={pending}
        onConfirm={onConfirmAccept}
        testId="parent-accept-offer-confirm"
      />
      {error ? (
        <p
          className="basis-full text-xs text-destructive"
          role="alert"
          data-testid="parent-offer-error"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function OfferFeeLine({ offer }: { offer: ParentAdmissionOffer }) {
  return (
    <p className="mt-0.5 text-xs text-muted-foreground">
      {formatFee(offer.feeAmount, offer.feeCurrency)}
      {offer.offerFeeInvoiceId
        ? ` · Invoice ${offer.offerFeeInvoiceId.slice(0, 8)}…`
        : ' · No invoice yet'}
      {offer.expiresAt ? ` · expires ${new Date(offer.expiresAt).toLocaleDateString()}` : ''}
    </p>
  );
}
