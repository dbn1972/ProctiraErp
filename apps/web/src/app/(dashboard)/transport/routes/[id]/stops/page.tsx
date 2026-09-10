import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireSession } from '@/lib/auth/server';
import { getTransportRoute } from '@/lib/api/transport';
import { listRouteStops } from '@/lib/transport/api';
import { StopsManager } from '../../../_components/stops-manager';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TransportRouteStopsPage(props: PageProps) {
  await requireSession();
  const { id } = await props.params;
  const route = await getTransportRoute(id);
  if (!route) notFound();
  const stops = await listRouteStops(route.id);

  return (
    <div className="space-y-6 p-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/transport/routes" className="underline-offset-4 hover:underline">
            Routes
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Stops — {route.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ordered pickup/drop points with optional coordinates and scheduled times.
        </p>
      </div>
      <StopsManager routeId={route.id} stops={stops} />
    </div>
  );
}
