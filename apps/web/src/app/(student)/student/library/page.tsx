import { requireStudentSession } from '../_lib/session';
import {
  listLibraryHoldsResult,
  listLibraryLoansResult,
  searchLibraryOpacResult,
} from '@/lib/api/library';
import type { ListFailureKind, ListResult } from '@/lib/api/list-result';
import {
  AcademicFrame,
  firstSearchParam,
} from '../../../(parent)/parent/_components/academic-frame';
import { Button, FormField, Input } from '@proctira/ui/components';

export const dynamic = 'force-dynamic';

function firstFailure(
  ...results: ListResult<unknown>[]
): { kind: ListFailureKind; status: number } | null {
  for (const result of results) {
    if (!result.ok) return { kind: result.kind, status: result.status };
  }
  return null;
}

function frameStatusFromKind(
  kind: ListFailureKind | null,
): 'ok' | 'forbidden' | 'error' {
  if (!kind) return 'ok';
  if (kind === 'denied' || kind === 'unauthenticated') return 'forbidden';
  return 'error';
}

export default async function StudentLibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireStudentSession();
  const params = await searchParams;
  const q = firstSearchParam(params.q) ?? '';
  const [itemsResult, loansResult, holdsResult] = await Promise.all([
    searchLibraryOpacResult(q),
    // The gateway pins student reads to the JWT subject (G-916 patron binding);
    // student loans/holds are keyed by students.id, which /student-portal/me also
    // resolves from the subject.
    listLibraryLoansResult({ studentId: session.user.sub }),
    listLibraryHoldsResult({ studentId: session.user.sub }),
  ]);
  const failure = firstFailure(itemsResult, loansResult, holdsResult);
  const status = frameStatusFromKind(failure?.kind ?? null);
  const items = itemsResult.ok ? itemsResult.items : [];
  const loans = loansResult.ok ? loansResult.items : [];
  const holds = holdsResult.ok ? holdsResult.items : [];

  return (
    <AcademicFrame
      title="Library"
      description="Search the catalogue and see your loans and holds."
      testId="student-library"
      status={status}
      errorMessage={
        failure
          ? failure.kind === 'unavailable'
            ? 'The library service is temporarily unavailable. Try again later.'
            : failure.kind === 'missing'
              ? 'Library records are not available for this school yet.'
              : undefined
          : undefined
      }
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
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    due {loan.dueAt.slice(0, 10)}
                  </p>
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
