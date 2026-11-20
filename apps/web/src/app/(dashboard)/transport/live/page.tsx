import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { hasDashboardDomainRouteAccess } from '@/lib/auth/domain-route-access';
import { listTransportVehicles } from '@/lib/api/transport';
import { resolveEntityLabel } from '@/lib/entity-label';
import { getLiveMap } from '@/lib/transport/api';
import { GpsDeviceForms } from '../_components/gps-device-forms';
import { LiveMapRefresher, LiveMapSvg } from '../_components/live-map';

export const dynamic = 'force-dynamic';

export default async function TransportLivePage() {
  // T-D1: check before any transport or student-directory read.
  if (!(await hasDashboardDomainRouteAccess('transport', '/transport'))) {
    return <RouteAccessDenied />;
  }
  const [live, vehicles] = await Promise.all([getLiveMap(), listTransportVehicles()]);
  const vehicleLabels = new Map(
    vehicles.flatMap((vehicle) => {
      const registration = vehicle.registrationNumber?.trim();
      return registration ? [[vehicle.id, registration] as const] : [];
    }),
  );

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Live map</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Last known vehicle positions on route stops. Select a marker to open its location in
          OpenStreetMap.
        </p>
      </div>
      <LiveMapRefresher />
      <LiveMapSvg vehicles={live.vehicles} stops={live.stops} />
      <ul className="text-sm text-muted-foreground" role="list">
        {live.vehicles.map((v) => (
          <li key={v.vehicleId} data-testid="transport-live-bus">
            {v.registrationNumber ?? resolveEntityLabel(v.vehicleId, vehicleLabels, 'Vehicle')} ·{' '}
            {v.latitude.toFixed(4)}, {v.longitude.toFixed(4)} ·{' '}
            <a
              href={v.osmUrl}
              className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
            >
              OpenStreetMap
            </a>
          </li>
        ))}
      </ul>
      <GpsDeviceForms vehicles={vehicles} />
    </div>
  );
}
