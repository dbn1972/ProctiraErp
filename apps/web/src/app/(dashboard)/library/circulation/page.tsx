import Link from 'next/link';

import { Button } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { ListLoadFailure } from '@/components/route-state/list-load-failure';
import { getListFailureCopy } from '@/components/route-state/list-failure-copy';
import { listLibraryItems } from '@/lib/api/library';
import { CirculationDesk } from '../_components/circulation-desk';

export const dynamic = 'force-dynamic';

export default async function LibraryCirculationPage() {
  const session = await requireSession();
  const itemsResult = await listLibraryItems();

  /**
   * A failed catalogue read degrades the desk, it does not disable it.
   *
   * The item picker silently matches nothing without the catalogue, so the failure has to be
   * said out loud — but barcode checkout and barcode return do not need the item list at all,
   * and an earlier revision removed those fields by early-returning the panel.
   */
  const failure = itemsResult.ok ? null : itemsResult;
  const items = itemsResult.ok ? itemsResult.items : [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Circulation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Check items out to borrowers and record returns.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/library">Back to library</Link>
        </Button>
      </div>
      {failure ? (
        <ListLoadFailure
          kind={failure.kind}
          status={failure.status}
          requestId={failure.requestId}
          returnTo="/library/circulation"
          copy={await getListFailureCopy()}
        />
      ) : null}
      <CirculationDesk items={items} patronUserId={session.user.sub} />
    </div>
  );
}
