import { requireSession } from '@/lib/auth/server';
import { listLibraryOverdues } from '@/lib/api/library';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';

export const dynamic = 'force-dynamic';

export default async function LibraryOverduesPage() {
  await requireSession();
  const overdues = await listLibraryOverdues();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Overdues</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live list from `/api/v1/library/overdues`.
        </p>
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
                <li key={loan.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-medium text-foreground">Loan {loan.id.slice(0, 8)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    due {loan.dueAt.slice(0, 10)} · {loan.status}
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
