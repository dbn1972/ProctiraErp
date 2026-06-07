import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { listPlans } from '@/lib/api/plans';
import { requireRole } from '@/lib/auth/server';

export default async function PlansPage() {
  await requireRole('plans', '/plans');
  const { plans } = await listPlans();

  return (
    <>
      <PageHeader
        title="Plans"
        description="Subscription tiers and the entitlements they grant by default."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan) => (
          <Link key={plan.id} href={`/plans/${plan.id}`}>
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{plan.name}</span>
                  <Badge variant="secondary" className="capitalize">
                    {plan.tier}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  {plan.activeTenants} active tenants
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Entitlements
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {plan.entitlements
                      .filter((e) => e.enabled)
                      .map((e) => (
                        <Badge key={e.key} variant="info">
                          {e.label}
                        </Badge>
                      ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
