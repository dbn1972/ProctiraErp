import { requireSession } from '@/lib/auth/server';
import { listChildren } from '@/lib/api/parent-portal';
import { listLibraryHolds, listLibraryLoans, searchLibraryOpac } from '@/lib/api/library';
import type { ListFailure } from '@/lib/api/list-result';
import {
  AcademicFrame,
  academicFrameStatusFor,
  firstSearchParam,
  pickChild,
} from '../_components/academic-frame';
import { Button, FormField, Input } from '@proctira/ui/components';

export const dynamic = 'force-dynamic';

export default async function ParentLibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession();
  const params = await searchParams;
  const q = firstSearchParam(params.q) ?? '';
  const children = await listChildren();
  const child = pickChild(children, firstSearchParam(params.studentId));

  if (!child) {
    return (
      <AcademicFrame
        title="Library"
        description="Search the catalogue and see your child's loans and holds."
        testId="parent-library"
        status="empty-children"
        emptyMessage="No catalogue results."
        hasRows={false}
      >
        {null}
      </AcademicFrame>
    );
  }

  const [itemsResult, loansResult, holdsResult] = await Promise.all([
    searchLibraryOpac(q),
    listLibraryLoans({ studentId: child.studentId }),
    listLibraryHolds({ studentId: child.studentId }),
  ]);

  /**
   * Loans and holds are this child's own borrowing record, and the consequence of getting
   * this wrong is concrete: a guardian shown "no loans" when the read was actually denied
   * has no way to know a book is overdue and accruing a fine.
   *
   * Two separate early returns rather than one combined `failed` check: TypeScript cannot
   * correlate a third variable back to the two results, so the combined form left both
   * still unnarrowed and `.items` unreachable.
   */
  const failureFrame = (failure: ListFailure) => (
    <AcademicFrame
      title="Library"
      description="Search the catalogue and see your child's loans and holds."
      testId="parent-library"
      childrenLinks={children}
      selectedId={child.studentId}
      status={academicFrameStatusFor(failure.kind)}
      errorMessage={`Unable to load library records (status ${failure.status}${
        failure.requestId ? `, reference ${failure.requestId}` : ''
      }).`}
      emptyMessage="No titles match this search."
      hasRows={false}
    >
      {null}
    </AcademicFrame>
  );
  if (!loansResult.ok) return failureFrame(loansResult);
  if (!holdsResult.ok) return failureFrame(holdsResult);

  const loans = loansResult.items;
  const holds = holdsResult.items;
  // The catalogue search is secondary here: a failure shows no results rather than hiding
  // the child's own records, which are the reason a guardian opened this page.
  const items = itemsResult.ok ? itemsResult.items : [];

  return (
    <AcademicFrame
      title="Library"
      description="Search the catalogue and see your child's loans and holds."
      testId="parent-library"
      childrenLinks={children}
      selectedId={child.studentId}
      status="ok"
      emptyMessage="No titles match this search."
      hasRows
    >
      <div className="space-y-6">
        <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Search OPAC">
          <input type="hidden" name="studentId" value={child.studentId} />
          <FormField id="parent-opac-q" label="Search titles">
            <Input id="parent-opac-q" name="q" defaultValue={q} className="h-11 min-h-11" />
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
                  {item.isbn ? ` · ISBN ${item.isbn}` : ''} · {item.available}/{item.copies}{' '}
                  available
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
          <h2 className="text-sm font-semibold text-foreground">Loans</h2>
          {loans.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground" role="status">
              No loans for this child.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border" role="list">
              {loans.map((loan) => (
                <li key={loan.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-medium text-foreground">{loan.status}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    due {loan.dueAt.slice(0, 10)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className="text-sm font-semibold text-foreground">Holds</h2>
          {holds.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground" role="status">
              No holds for this child.
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
