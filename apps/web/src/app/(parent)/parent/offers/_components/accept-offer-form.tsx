'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button, FormField, Input } from '@proctira/ui/components';
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

  if (offer.status !== 'sent') {
    return null;
  }

  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2"
      data-testid="parent-accept-offer-form"
      data-hydrated={hydrated ? 'true' : 'false'}
      onSubmit={(event) => {
        event.preventDefault();
        const fd = new FormData(event.currentTarget);
        const paymentRef = String(fd.get('paymentRef') ?? '').trim();
        startTransition(async () => {
          setError(null);
          const result = await acceptGuardianOfferAction({
            offerId: offer.id,
            paymentRef,
            offerFeeInvoiceId: offer.offerFeeInvoiceId ?? undefined,
          });
          if (result.status === 'error') {
            setError(result.message ?? 'Accept failed');
            return;
          }
          router.refresh();
        });
      }}
    >
      <FormField id={`pay-ref-${offer.id}`} label="Payment reference">
        <Input
          id={`pay-ref-${offer.id}`}
          name="paymentRef"
          required
          defaultValue="SANDBOX-PAY"
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
