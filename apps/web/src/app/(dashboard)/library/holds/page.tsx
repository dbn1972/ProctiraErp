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
import { listLibraryHolds, listLibraryItems } from '@/lib/api/library';
import { PlaceHoldForm } from '../_components/place-hold-form';

export const dynamic = 'force-dynamic';

export default async function LibraryHoldsPage() {
  await requireSession();
  const [items, holds] = await Promise.all([listLibraryItems(), listLibraryHolds()]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Holds</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            FIFO reservation queue. Returning a copy promotes the next patron.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/library">Back to library</Link>
        </Button>
      </div>

      <PlaceHoldForm items={items} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active holds</CardTitle>
          <CardDescription>
            {holds.length === 0
              ? 'No holds yet.'
              : `${holds.length} hold${holds.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {holds.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No holds yet.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {holds.map((hold) => (
                <li
                  key={hold.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="library-hold-row"
                >
                  <p className="text-sm font-medium text-foreground">
                    {hold.status} · position {hold.position}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    item {hold.itemId.slice(0, 8)}
                    {hold.expiresAt ? ` · expires ${hold.expiresAt.slice(0, 10)}` : ''}
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
