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
import { searchLibraryOpac } from '@/lib/api/library';
import { OpacSearchForm } from '../_components/opac-search-form';

export const dynamic = 'force-dynamic';

export default async function LibraryOpacPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireSession();
  const { q = '' } = await searchParams;
  const query = q.trim();
  const items = query ? await searchLibraryOpac(query) : [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">OPAC</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Read-only catalogue search for staff, students, and parents.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/library">Back to library</Link>
        </Button>
      </div>

      <OpacSearchForm defaultQuery={query} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Results</CardTitle>
          <CardDescription>
            {query
              ? items.length === 0
                ? 'No titles match this search.'
                : `${items.length} title${items.length === 1 ? '' : 's'}.`
              : 'Enter a title, author, ISBN, or barcode.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status" data-testid="library-opac-empty">
              {query ? 'No titles match this search.' : 'Search the catalogue.'}
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="library-opac-row"
                >
                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.author ?? 'Unknown author'}
                    {item.isbn ? ` · ISBN ${item.isbn}` : ''} · {item.available}/{item.copies}{' '}
                    available
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
