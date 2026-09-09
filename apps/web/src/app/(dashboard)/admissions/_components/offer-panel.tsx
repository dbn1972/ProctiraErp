'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
} from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';
import type { AdmissionOffer, ApplicationBundle } from '@/lib/api/admissions';
import {
  acceptOfferAction,
  createOfferAction,
  declineOfferAction,
  sendOfferAction,
} from '../../admissions-actions';

export function OfferPanel({ bundle }: { bundle: ApplicationBundle }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { application, offers } = bundle;
  const enrolled = offers.find((row) => row.enrolledStudentId)?.enrolledStudentId ?? null;

  function run(task: () => Promise<{ status: string; message?: string }>) {
    startTransition(async () => {
      setError(null);
      const result = await task();
      if (result.status === 'error') {
        setError(result.message ?? 'Failed');
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Offers</CardTitle>
        <CardDescription>
          Draft, send, accept (sandbox payment ref) or decline. Acceptance enrols the student.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {enrolled ? (
          <p
            data-testid="enrolled-badge"
            className="inline-flex items-center gap-1 rounded-md border border-transparent bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground"
          >
            Enrolled
            <Link
              className="underline"
              href={`/students/${enrolled}`}
              data-testid="enrolled-student-link"
            >
              Open student
            </Link>
          </p>
        ) : null}

        <form
          className="flex flex-wrap items-end gap-2"
          data-testid="create-offer-form"
          data-hydrated={hydrated ? 'true' : 'false'}
          onSubmit={(event) => {
            event.preventDefault();
            const fd = new FormData(event.currentTarget);
            run(() =>
              createOfferAction({
                applicationId: application.id,
                feeAmount: Number(fd.get('feeAmount') || 0),
              }),
            );
          }}
        >
          <FormField id="offer-fee" label="Offer fee">
            <Input
              id="offer-fee"
              name="feeAmount"
              type="number"
              min={0}
              defaultValue={0}
              data-testid="offer-fee"
              disabled={!hydrated || pending}
            />
          </FormField>
          <Button
            type="submit"
            data-testid="create-offer"
            disabled={!hydrated || pending || !bundle.placement}
          >
            Draft offer
          </Button>
        </form>

        {offers.length === 0 ? (
          <p className="text-sm text-muted-foreground" role="status">
            {bundle.placement
              ? 'No offers yet.'
              : 'Set grade/period placement before creating an offer.'}
          </p>
        ) : (
          <ul className="space-y-3" role="list">
            {offers.map((offer) => (
              <OfferRow
                key={offer.id}
                offer={offer}
                applicationId={application.id}
                hydrated={hydrated}
                pending={pending}
                onSend={() => run(() => sendOfferAction(offer.id, application.id))}
                onDecline={() => run(() => declineOfferAction(offer.id, application.id))}
                onAccept={(paymentRef) =>
                  run(() => acceptOfferAction({ offerId: offer.id, paymentRef }))
                }
              />
            ))}
          </ul>
        )}
        {error ? (
          <p className="text-sm text-destructive" role="alert" data-testid="offer-error">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function OfferRow({
  offer,
  applicationId,
  hydrated,
  pending,
  onSend,
  onDecline,
  onAccept,
}: {
  offer: AdmissionOffer;
  applicationId: string;
  hydrated: boolean;
  pending: boolean;
  onSend: () => void;
  onDecline: () => void;
  onAccept: (paymentRef: string) => void;
}) {
  return (
    <li
      className="rounded-md border border-border p-3"
      data-testid="offer-row"
      data-status={offer.status}
    >
      <p className="text-sm font-medium">
        {offer.status} · {offer.feeAmount} {offer.feeCurrency}
      </p>
      {offer.paymentRef ? (
        <p className="text-xs text-muted-foreground">Ref {offer.paymentRef}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {offer.status === 'draft' ? (
          <Button
            type="button"
            size="sm"
            data-testid="send-offer"
            disabled={!hydrated || pending}
            onClick={onSend}
          >
            Send
          </Button>
        ) : null}
        {offer.status === 'sent' || offer.status === 'draft' ? (
          <form
            className="flex flex-wrap items-end gap-2"
            data-hydrated={hydrated ? 'true' : 'false'}
            onSubmit={(event) => {
              event.preventDefault();
              const fd = new FormData(event.currentTarget);
              onAccept(String(fd.get('paymentRef') ?? ''));
            }}
          >
            <FormField id={`pay-${offer.id}`} label="Payment ref">
              <Input
                id={`pay-${offer.id}`}
                name="paymentRef"
                data-testid="payment-ref"
                required
                disabled={!hydrated || pending}
                defaultValue="SANDBOX-PAY"
              />
            </FormField>
            <Button
              type="submit"
              size="sm"
              data-testid="accept-offer"
              disabled={!hydrated || pending}
            >
              Accept
            </Button>
          </form>
        ) : null}
        {offer.status !== 'accepted' && offer.status !== 'declined' ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="decline-offer"
            disabled={!hydrated || pending}
            onClick={onDecline}
          >
            Decline
          </Button>
        ) : null}
      </div>
      <p className="sr-only">{applicationId}</p>
    </li>
  );
}
