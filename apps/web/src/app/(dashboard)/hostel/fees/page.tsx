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
import { listHostelFeeStructures, listHostels } from '@/lib/api/hostel';
import { HostelFeeStructureForm } from '../_components/fee-structure-form';

export const dynamic = 'force-dynamic';

export default async function HostelFeesPage() {
  await requireSession();
  const [hostels, rows] = await Promise.all([listHostels(), listHostelFeeStructures()]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Hostel fee structures
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Room type × term amounts. Fees consumes GET `/hostel/fee-structures/summary`.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/hostel">Back to hostel</Link>
        </Button>
      </div>

      <HostelFeeStructureForm hostels={hostels} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Published structures</CardTitle>
          <CardDescription>
            {rows.length === 0
              ? 'No fee structures yet.'
              : `${rows.length} structure${rows.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No fee structures yet.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {rows.map((row) => (
                <li key={row.id} className="py-3 first:pt-0 last:pb-0" data-testid="hostel-fee-row">
                  <p className="text-sm font-medium text-foreground">
                    {row.roomType} · {row.termLabel}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {row.amountCents} {row.currency}
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
