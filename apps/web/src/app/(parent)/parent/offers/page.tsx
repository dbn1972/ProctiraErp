/**
 * Parent admission offers — view fee invoice + sandbox pay/accept (A2).
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listGuardianOffers, type ParentAdmissionOffer } from '@/lib/api/parent-portal';
import { GatewayError } from '@/lib/api/gateway';
import { AcceptOfferForm, OfferFeeLine } from './_components/accept-offer-form';

export const dynamic = 'force-dynamic';

export default async function ParentOffersPage() {
  await requireSession();

  let offers: ParentAdmissionOffer[] = [];
  let loadError: string | null = null;
  try {
    offers = await listGuardianOffers();
  } catch (error) {
    loadError =
      error instanceof GatewayError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Failed to load offers';
  }

  const openOffers = offers.filter((row) => row.status === 'sent');
  const acceptedOffers = offers.filter((row) => row.status === 'accepted');

  return (
    <div className="space-y-6" data-testid="parent-offers">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Offers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review admission offers for your family, record a sandbox payment reference, and accept to
          enrol.
        </p>
      </div>

      <div
        className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-foreground"
        role="status"
        data-testid="sandbox-honesty-banner"
      >
        <p className="font-medium">Sandbox payment only</p>
        <p className="mt-1 text-muted-foreground">
          Live payment service providers are not connected for family offer fees. Use the sandbox
          payment reference (same as staff) — this does not charge a real card.
        </p>
      </div>

      {loadError ? (
        <p className="text-sm text-destructive" role="alert" data-testid="parent-offers-load-error">
          {loadError}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Open offers</CardTitle>
          <CardDescription>
            {openOffers.length === 0
              ? 'No open offers for your account email right now.'
              : `${openOffers.length} open offer${openOffers.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {openOffers.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              When the school sends an offer linked to your guardian email, it appears here with the
              fee amount and invoice id.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {openOffers.map((offer) => (
                <li
                  key={offer.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="parent-offer-row"
                  data-status={offer.status}
                >
                  <p className="text-sm font-medium text-foreground">
                    {offer.applicantFirstName} {offer.applicantLastName}
                  </p>
                  <OfferFeeLine offer={offer} />
                  <AcceptOfferForm offer={offer} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {acceptedOffers.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Accepted</CardTitle>
            <CardDescription>Offers you have already accepted.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border" role="list">
              {acceptedOffers.map((offer) => (
                <li
                  key={offer.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="parent-offer-accepted-row"
                >
                  <p className="text-sm font-medium text-foreground">
                    {offer.applicantFirstName} {offer.applicantLastName} · enrolled
                  </p>
                  <OfferFeeLine offer={offer} />
                  {offer.paymentRef ? (
                    <p className="mt-1 text-xs text-muted-foreground">Ref {offer.paymentRef}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
