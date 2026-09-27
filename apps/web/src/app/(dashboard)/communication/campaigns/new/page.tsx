import { requireSession } from '@/lib/auth/server';
import { listHostels } from '@/lib/api/hostel';
import { listTransportRoutes } from '@/lib/api/transport';
import { toNamedOptions } from '@/lib/communication/named-options';

import { NewCampaignForm } from '../../_components/new-campaign-form';

export const dynamic = 'force-dynamic';

export default async function NewCommunicationCampaignPage() {
  const session = await requireSession();
  const [hostels, routes] = await Promise.all([
    listHostels().catch(() => []),
    listTransportRoutes().catch(() => []),
  ]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">New campaign</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Draft a multi-channel outreach campaign. You can send it after review.
        </p>
      </div>
      <NewCampaignForm
        createdBy={session.user.sub}
        hostelOptions={toNamedOptions(hostels)}
        routeOptions={toNamedOptions(routes)}
      />
    </div>
  );
}
