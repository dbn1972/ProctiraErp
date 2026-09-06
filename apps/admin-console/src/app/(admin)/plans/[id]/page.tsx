import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { MissingResource } from '@/components/missing-resource';
import { StubDataBanner } from '@/components/stub-data-banner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getPlan } from '@/lib/api/plans';
import { requireRole } from '@/lib/auth/server';

import { updateEntitlementsAction } from '../actions';

export default async function PlanDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireRole('plans', `/plans/${params.id}`);
  const { plan, source } = await getPlan(params.id);
  if (!plan) {
    return (
      <MissingResource
        title="Plan"
        resourceLabel="Plan"
        id={params.id}
        backHref="/plans"
        backLabel="Back to plans"
      />
    );
  }

  return (
    <>
      <PageHeader
        title={`Plan: ${plan.name}`}
        description={`${plan.activeTenants} active tenants on this tier.`}
        actions={
          <Button asChild variant="outline">
            <Link href="/plans">Back to plans</Link>
          </Button>
        }
      />

      <StubDataBanner source={source} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Feature entitlements</CardTitle>
            <CardDescription>
              Toggle which feature capabilities are granted to tenants on this
              plan by default. Tenants can also have additional per-tenant
              entitlements granted from their detail page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={updateEntitlementsAction} className="space-y-3">
              <input type="hidden" name="planId" value={plan.id} />
              {plan.entitlements.map((entitlement) => (
                <label
                  key={entitlement.key}
                  className="flex items-start justify-between gap-4 rounded-md border border-border p-3"
                >
                  <div className="space-y-0.5">
                    <div className="font-medium text-sm">{entitlement.label}</div>
                    {entitlement.description && (
                      <div className="text-xs text-muted-foreground">
                        {entitlement.description}
                      </div>
                    )}
                    <code className="text-xs text-muted-foreground">
                      {entitlement.key}
                    </code>
                  </div>
                  <input
                    type="checkbox"
                    name={`entitlement.${entitlement.key}`}
                    defaultChecked={entitlement.enabled}
                    className="mt-1 h-4 w-4 rounded border-input accent-[hsl(var(--primary))]"
                  />
                </label>
              ))}
              <div className="flex justify-end pt-2">
                <Button type="submit">Save entitlements</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Plan summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Tier
              </div>
              <Badge variant="secondary" className="mt-1 capitalize">
                {plan.tier}
              </Badge>
            </div>
            {plan.quotas && (
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Quotas
                </div>
                <div className="mt-1 space-y-1 text-sm">
                  {Object.entries(plan.quotas).map(([key, value]) => (
                    <div key={key} className="flex justify-between">
                      <span className="text-muted-foreground">{key}</span>
                      <span className="font-medium">
                        {value.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
