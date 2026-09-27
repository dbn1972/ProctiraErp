import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { MissingResource } from '@/components/missing-resource';
import { StubDataBanner } from '@/components/stub-data-banner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getPlan } from '@/lib/api/plans';
import { requireRole } from '@/lib/auth/server';

import { EntitlementsForm } from './entitlements-form';

export default async function PlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireRole('plans', `/plans/${id}`);
  const { plan, source } = await getPlan(id);
  if (!plan) {
    return (
      <MissingResource
        title="Plan"
        resourceLabel="Plan"
        id={id}
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
              Toggle which feature capabilities are granted to tenants on this plan by default.
              Tenants can also have additional per-tenant entitlements granted from their detail
              page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EntitlementsForm
              planId={plan.id}
              planName={plan.name}
              entitlements={plan.entitlements}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Plan summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Tier</div>
              <Badge variant="secondary" className="mt-1 capitalize">
                {plan.tier}
              </Badge>
            </div>
            {plan.quotas && (
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Quotas</div>
                <div className="mt-1 space-y-1 text-sm">
                  {Object.entries(plan.quotas).map(([key, value]) => (
                    <div key={key} className="flex justify-between">
                      <span className="text-muted-foreground">{key}</span>
                      <span className="font-medium">{value.toLocaleString()}</span>
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
