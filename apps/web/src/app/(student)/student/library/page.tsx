import { requireStudentSession } from '../_lib/session';
import { listLibraryHolds, listLibraryLoans, searchLibraryOpac } from '@/lib/api/library';
import { AcademicFrame, firstSearchParam } from '../../../(parent)/parent/_components/academic-frame';
import { Button, FormField, Input } from '@proctira/ui/components';

export const dynamic = 'force-dynamic';

export default async function StudentLibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireStudentSession();
  const params = await searchParams;
  const q = firstSearchParam(params.q) ?? '';
  const [items, loans, holds] = await Promise.all([
    searchLibraryOpac(q),
    listLibraryLoans({ patronUserId: session.user.sub }),
    listLibraryHolds({ patronUserId: session.user.sub }),
  ]);

  return (
    <AcademicFrame
      title="Library"
      description="Search the catalogue and see your loans and holds."
      testId="student-library"
      status="ok"
      emptyMessage="No titles match this search."
      hasRows
    >
      <div className="space-y-6">
        <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Search OPAC">
          <FormField id="student-opac-q" label="Search titles">
            <Input id="student-opac-q" name="q" defaultValue={q} className="h-11 min-h-11" />
          </FormField>
          <Button type="submit" className="min-h-11">
            Search
          </Button>
        </form>

        {items.length > 0 ? (
          <ul className="divide-y divide-border" role="list">
            {items.map((item) => (
              <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                <p className="text-sm font-medium text-foreground">{item.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {item.author ?? 'Unknown author'}
                  {item.isbn ? ` · ISBN ${item.isbn}` : ''} · {item.available}/{item.copies} available
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground" role="status">
            {q ? 'No titles match this search.' : 'Enter a title, author, or ISBN to search.'}
          </p>
        )}

        <div>
          <h2 className="text-sm font-semibold text-foreground">My loans</h2>
          {loans.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground" role="status">
              No loans on this account.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border" role="list">
              {loans.map((loan) => (
                <li key={loan.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-medium text-foreground">{loan.status}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">due {loan.dueAt.slice(0, 10)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className="text-sm font-semibold text-foreground">My holds</h2>
          {holds.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground" role="status">
              No holds on this account.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border" role="list">
              {holds.map((hold) => (
                <li key={hold.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-medium text-foreground">
                    {hold.status} · position {hold.position}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AcademicFrame>
  );
}
