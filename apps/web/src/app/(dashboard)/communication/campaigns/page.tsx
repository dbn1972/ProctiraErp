/**
 * Communication campaigns list (Server Component shell).
 */
import Link from 'next/link';

import { Button } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export default async function CommunicationCampaignsPage() {
  await requireSession();

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            List and manage communication campaigns via GET/POST `/communication/campaigns`.
          </p>
        </div>
        <Button asChild>
          <Link href="/communication/campaigns/new">New campaign</Link>
        </Button>
      </div>
    </div>
  );
}
