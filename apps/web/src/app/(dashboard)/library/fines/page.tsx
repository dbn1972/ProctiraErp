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
import { listLibraryFines } from '@/lib/api/library';
import { MarkPaidButton } from '../_components/mark-paid-button';

export const dynamic = 'force-dynamic';

export default async function LibraryFinesPage() {
  await requireSession();
  const fines = await listLibraryFines();

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Fines</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Assess overdue loans, then mark the fine paid. Fees can consume the summary route.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/library/overdues">Overdues</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/library">Back to library</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Library fines</CardTitle>
          <CardDescription>
            {fines.length === 0
              ? 'No fines yet.'
              : `${fines.length} fine${fines.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {fines.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No fines yet. Assess from Overdues.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {fines.map((fine) => (
                <li
                  key={fine.id}
                  className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  data-testid="library-fine-row"
                  data-fine-status={fine.status}
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {fine.amountCents} cents · {fine.status}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      loan {fine.loanId.slice(0, 8)} · {fine.overdueDays} overdue day
                      {fine.overdueDays === 1 ? '' : 's'}
                    </p>
                  </div>
                  {fine.status !== 'paid' ? <MarkPaidButton fineId={fine.id} /> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
