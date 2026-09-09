import Link from 'next/link';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';

import { requireSession } from '@/lib/auth/server';
import { listHostelMessPlans, listHostels } from '@/lib/api/hostel';
import { MessOpsForms } from '../_components/mess-ops-forms';

export const dynamic = 'force-dynamic';

export default async function HostelMessPage() {
  await requireSession();
  const [hostels, plans] = await Promise.all([listHostels(), listHostelMessPlans()]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Mess plans</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan × meals × weekly menu, then subscribe residents.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/hostel">Back to hostel</Link>
        </Button>
      </div>

      <MessOpsForms hostels={hostels} plans={plans} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Published plans</CardTitle>
          <CardDescription>
            {plans.length === 0
              ? 'No mess plans yet.'
              : `${plans.length} plan${plans.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {plans.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No mess plans yet.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {plans.map((plan) => (
                <li
                  key={plan.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="hostel-mess-plan-row"
                >
                  <p className="text-sm font-medium text-foreground">{plan.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {plan.mealCount} meal{plan.mealCount === 1 ? '' : 's'} · {plan.status}
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
