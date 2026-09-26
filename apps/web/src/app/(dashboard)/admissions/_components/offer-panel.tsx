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
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import { useHydrated } from '@/hooks/useHydrated';
import type { AdmissionOffer, ApplicationBundle } from '@/lib/api/admissions';
import {
  acceptOfferAction,
  createOfferAction,
  declineOfferAction,
  sendOfferAction,
} from '../../admissions-actions';

export function OfferPanel({
  bundle,
  classes,
}: {
  bundle: ApplicationBundle;
  classes: Array<{ id: string; name: string }>;
}) {
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
                classId: String(fd.get('classId') ?? ''),
                feeAmount: Number(fd.get('feeAmount') || 0),
              }),
            );
          }}
        >
          <FormField id="offer-class" label="Class / section">
            <select
              id="offer-class"
              name="classId"
              required
              defaultValue={classes.length === 1 ? classes[0]!.id : ''}
              disabled={!hydrated || pending || classes.length === 0}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              data-testid="offer-class"
            >
              <option value="" disabled>
                {classes.length === 0 ? 'No matching class available' : 'Select class'}
              </option>
              {classes.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </FormField>
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
            disabled={!hydrated || pending || !bundle.placement || classes.length === 0}
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
  const [confirm, setConfirm] = useState<'send' | 'accept' | 'decline' | null>(null);
  const [paymentRef, setPaymentRef] = useState('SANDBOX-PAY');

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
            onClick={() => setConfirm('send')}
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
              setPaymentRef(String(fd.get('paymentRef') ?? ''));
              setConfirm('accept');
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
            onClick={() => setConfirm('decline')}
          >
            Decline
          </Button>
        ) : null}
      </div>
      <ConfirmActionDialog
        open={confirm === 'send'}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title="Send this offer?"
        description="Sending notifies the family and moves the offer out of draft. Confirm the fee and class before continuing."
        confirmLabel="Send offer"
        pending={pending}
        onConfirm={() => {
          setConfirm(null);
          onSend();
        }}
        testId={`send-offer-confirm-${offer.id}`}
      />
      <ConfirmActionDialog
        open={confirm === 'accept'}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title="Accept offer and enrol?"
        description={`Acceptance enrols the student for ${offer.feeAmount} ${offer.feeCurrency} and cannot be undone from this screen.`}
        confirmLabel="Accept & enrol"
        pending={pending}
        onConfirm={() => {
          setConfirm(null);
          onAccept(paymentRef);
        }}
        testId={`accept-offer-confirm-${offer.id}`}
      />
      <ConfirmActionDialog
        open={confirm === 'decline'}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title="Decline this offer?"
        description="Declining closes the offer. The family will need a new offer if you change your mind."
        confirmLabel="Decline offer"
        destructive
        pending={pending}
        onConfirm={() => {
          setConfirm(null);
          onDecline();
        }}
        testId={`decline-offer-confirm-${offer.id}`}
      />
      <p className="sr-only">{applicationId}</p>
    </li>
  );
}
