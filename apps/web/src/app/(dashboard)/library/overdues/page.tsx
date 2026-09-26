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
import { listLibraryItemsResult, listLibraryOverduesResult } from '@/lib/api/library';
import { ListLoadFailure } from '@/components/route-state/list-load-failure';
import { resolveEntityLabel } from '@/lib/entity-label';
import { loadStudentLabelMap } from '@/lib/load-entity-labels';
import { AssessFineButton } from '../_components/assess-fine-button';

export const dynamic = 'force-dynamic';

export default async function LibraryOverduesPage() {
  await requireSession();
  const [result, itemsResult, studentLabels] = await Promise.all([
    listLibraryOverduesResult(),
    listLibraryItemsResult(),
    loadStudentLabelMap(),
  ]);

  if (!result.ok) {
    return (
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Overdues</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Items past their due date that still need follow-up.
          </p>
        </div>
        <ListLoadFailure kind={result.kind} status={result.status} returnTo="/library/overdues" />
      </div>
    );
  }

  const overdues = result.items;
  const items = itemsResult.ok ? itemsResult.items : [];
  const itemLabels = new Map(items.map((item) => [item.id, item.title]));

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Overdues</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Items past their due date that still need follow-up.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/library/fines">Fines</Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Overdue loans</CardTitle>
          <CardDescription>
            {overdues.length === 0
              ? 'No overdues.'
              : `${overdues.length} overdue loan${overdues.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {overdues.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No overdues.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {overdues.map((loan) => (
                <li
                  key={loan.id}
                  className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  data-testid="library-overdue-row"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {resolveEntityLabel(loan.itemId, itemLabels, 'Title')}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {resolveEntityLabel(loan.studentId, studentLabels, 'Student')} · due{' '}
                      {loan.dueAt.slice(0, 10)} · {loan.status}
                      {loan.barcode ? ` · ${loan.barcode}` : ''}
                    </p>
                  </div>
                  <AssessFineButton loanId={loan.id} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
