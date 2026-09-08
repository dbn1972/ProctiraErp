/**
 * Parent consents (Server Component).
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listConsents } from '@/lib/api/parent-portal';
import { ConsentDecisionButtons } from './_components/consent-decision-buttons';

export const dynamic = 'force-dynamic';

export default async function ParentConsentsPage() {
  await requireSession();
  const consents = await listConsents();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Consents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review permission requests from the school and approve or deny them.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Consent requests</CardTitle>
          <CardDescription>
            {consents.length === 0
              ? 'Nothing waiting for your decision.'
              : `${consents.length} request${consents.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {consents.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              You are all caught up — there are no pending permission requests.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {consents.map((consent) => (
                <li
                  key={consent.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="parent-consent-row"
                >
                  <p className="text-sm font-medium text-foreground">{consent.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {consent.consentType} · Student {consent.studentId.slice(0, 8)}… ·{' '}
                    {consent.status}
                  </p>
                  {consent.description ? (
                    <p className="mt-1 text-sm text-muted-foreground">{consent.description}</p>
                  ) : null}
                  <ConsentDecisionButtons consentId={consent.id} status={consent.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
