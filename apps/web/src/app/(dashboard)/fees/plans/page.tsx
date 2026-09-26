/**
 * Staff fee plans (Server Component).
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listFeePlansResult } from '@/lib/api/fees';
import { ListLoadFailure } from '@/components/route-state/list-load-failure';
import { humanizeStatus } from '@/lib/status-label';
import { NewFeePlanForm } from '../_components/new-fee-plan-form';

import { getLocale } from 'next-intl/server';

import { formatAmount } from '../_components/format-amount';

export const dynamic = 'force-dynamic';

export default async function FeesPlansPage() {
  await requireSession();
  const locale = await getLocale();
  const plansResult = await listFeePlansResult();
  const plans = plansResult.ok ? plansResult.items : [];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Fee plans</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Templates used when issuing student invoices.
        </p>
      </div>

      <NewFeePlanForm />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plans</CardTitle>
          <CardDescription>
            {!plansResult.ok
              ? 'Plans could not be loaded.'
              : plans.length === 0
                ? 'No plans yet.'
                : `${plans.length} plan(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!plansResult.ok ? (
            <ListLoadFailure
              kind={plansResult.kind}
              status={plansResult.status}
              returnTo="/fees/plans"
            />
          ) : plans.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              Create a plan to issue recurring or term invoices quickly.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {plans.map((plan) => (
                <li key={plan.id} className="py-3 first:pt-0 last:pb-0" data-testid="fee-plan-row">
                  <p className="text-sm font-medium text-foreground">
                    {plan.name}{' '}
                    <span className="font-normal text-muted-foreground">({plan.code})</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatAmount(plan.amountCents, plan.currency, locale)} ·{' '}
                    {humanizeStatus(plan.frequency)} · {humanizeStatus(plan.status)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
