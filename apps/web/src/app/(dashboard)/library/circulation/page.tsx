import Link from 'next/link';

import { Button } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { ListLoadFailurePage } from '@/components/route-state/list-load-failure-page';
import { getListFailureCopy } from '@/components/route-state/list-failure-copy';
import { listLibraryItems } from '@/lib/api/library';
import { CirculationDesk } from '../_components/circulation-desk';

export const dynamic = 'force-dynamic';

export default async function LibraryCirculationPage() {
  const session = await requireSession();
  const itemsResult = await listLibraryItems();

  // The desk cannot work without the catalogue: an empty item list renders a picker that
  // silently matches nothing, so a denial has to be said out loud.
  if (!itemsResult.ok) {
    return (
      <ListLoadFailurePage
        heading="Circulation"
        kind={itemsResult.kind}
        status={itemsResult.status}
        requestId={itemsResult.requestId}
        returnTo="/library/circulation"
        copy={await getListFailureCopy()}
      />
    );
  }
  const items = itemsResult.items;

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
      <CirculationDesk items={items} patronUserId={session.user.sub} />
    </div>
  );
}
