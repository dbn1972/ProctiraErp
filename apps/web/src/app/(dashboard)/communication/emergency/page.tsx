import Link from 'next/link';

import { Button } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listEmergencyBlasts } from '@/lib/api/communication';
import { ListLoadFailure } from '@/components/route-state/list-load-failure';
import { EmergencyBlastPanel } from '../_components/emergency-blast-panel';

export const dynamic = 'force-dynamic';

export default async function CommunicationEmergencyPage() {
  const session = await requireSession();
  const result = await listEmergencyBlasts();

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Emergency blasts
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Requires two confirmations before send. Use only for genuine emergencies.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/communication">Back to communication</Link>
        </Button>
      </div>
      {result.ok ? (
        <EmergencyBlastPanel actorId={session.user.sub} initialBlasts={result.items} />
      ) : (
        <ListLoadFailure
          kind={result.kind}
          status={result.status}
          returnTo="/communication/emergency"
        />
      )}
    </div>
  );
}
