import Link from 'next/link';

import { Button } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listEmergencyBlasts } from '@/lib/api/communication';
import { EmergencyBlastPanel } from '../_components/emergency-blast-panel';

export const dynamic = 'force-dynamic';

export default async function CommunicationEmergencyPage() {
  const session = await requireSession();
  const blasts = await listEmergencyBlasts();

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Emergency blasts
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dual-confirm emergency messaging via `/api/v1/communication/emergency`.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/communication">Back to communication</Link>
        </Button>
      </div>
      <EmergencyBlastPanel actorId={session.user.sub} initialBlasts={blasts} />
    </div>
  );
}
