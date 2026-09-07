/**
 * Library catalog (Server Component).
 */
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
import { listLibraryItems } from '@/lib/api/library';
import { LibraryClearanceForm } from './_components/clearance-form';
import { NewLibraryItemForm } from './_components/new-item-form';

export const dynamic = 'force-dynamic';

export default async function LibraryCatalogPage() {
  await requireSession();
  const items = await listLibraryItems();

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Library</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Catalog and circulation. Gateway plugin: `/api/v1/library`.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/library/circulation">Circulation</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/library/overdues">Overdues</Link>
          </Button>
        </div>
      </div>

      <NewLibraryItemForm />
      <LibraryClearanceForm />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Catalog</CardTitle>
          <CardDescription>
            {items.length === 0
              ? 'No holdings yet.'
              : `${items.length} item${items.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No holdings yet.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="library-item-row"
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
