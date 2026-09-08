import Link from 'next/link';
import { Check, X } from 'lucide-react';

import { PageHeader } from '@/components/layout/page-header';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StubDataBanner } from '@/components/stub-data-banner';
import { listPlans } from '@/lib/api/plans';
import { requireRole } from '@/lib/auth/server';

export default async function PlansPage() {
  await requireRole('plans', '/plans');
  const { plans, source } = await listPlans();

  // Build a union of all entitlement keys/labels across plans for the matrix.
  const entitlementMap = new Map<string, string>();
  for (const plan of plans) {
    for (const e of plan.entitlements) {
      if (!entitlementMap.has(e.key)) entitlementMap.set(e.key, e.label);
    }
  }
  const allEntitlements = Array.from(entitlementMap.entries());

  return (
    <>
      <PageHeader
        title="Plan management"
        description="Pricing tiers and the entitlements they grant by default. Changes apply at the next billing cycle and are recorded as plan.update events."
      />

      <StubDataBanner source={source} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan) => (
          <Card key={plan.id} className="flex h-full flex-col">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <Link href={`/plans/${plan.id}`} className="hover:underline">
                  {plan.name}
                </Link>
                <Badge variant="secondary" className="capitalize">
                  {plan.tier}
                </Badge>
              </CardTitle>
              <CardDescription>
                {plan.activeTenants} active tenant
                {plan.activeTenants === 1 ? '' : 's'}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              <ul className="space-y-2.5">
                {plan.entitlements.map((e) => (
                  <li
                    key={e.key}
                    className={`flex items-start gap-2 text-sm ${
                      e.enabled ? 'text-foreground' : 'text-muted-foreground line-through'
                    }`}
                  >
                    {e.enabled ? (
                      <Check
                        className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--success))]"
                        aria-hidden="true"
                      />
                    ) : (
                      <X
                        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                    <span>{e.label}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter className="justify-between border-t border-border pt-4">
              <span className="font-mono text-xs text-muted-foreground">{plan.id}</span>
              <Link
                href={`/plans/${plan.id}`}
                className="text-sm font-medium text-[hsl(var(--accent))] hover:underline"
              >
                Manage →
              </Link>
            </CardFooter>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Entitlement comparison</CardTitle>
          <CardDescription>Feature flags resolved per plan.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entitlement</TableHead>
                <TableHead>Key</TableHead>
                {plans.map((plan) => (
                  <TableHead key={plan.id} className="text-center">
                    {plan.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {allEntitlements.map(([key, label]) => (
                <TableRow key={key}>
                  <TableCell className="font-medium">{label}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{key}</TableCell>
                  {plans.map((plan) => {
                    const ent = plan.entitlements.find((e) => e.key === key);
                    const enabled = ent?.enabled ?? false;
                    return (
                      <TableCell key={plan.id} className="text-center">
                        {enabled ? (
                          <Badge variant="success">Included</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Not included</span>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
