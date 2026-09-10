import { requireSession } from '@/lib/auth/server';
import { listTransportRoutes } from '@/lib/api/transport';
import { listAllStops, listFeeLinks, listTransportFeeStructures } from '@/lib/transport/api';
import { FeesPanel } from '../_components/fees-panel';

export const dynamic = 'force-dynamic';

export default async function TransportFeesPage() {
  await requireSession();
  const [routes, stops, bands, links] = await Promise.all([
    listTransportRoutes(),
    listAllStops(),
    listTransportFeeStructures(),
    listFeeLinks(),
  ]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Transport fees</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Stop/route fee bands linked to G-903 FeesService. Assigning a student to a stop creates
          the fee line or a pending link.
        </p>
      </div>
      <FeesPanel routes={routes} stops={stops} bands={bands} links={links} />
    </div>
  );
}
