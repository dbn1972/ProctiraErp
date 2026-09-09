import { requireSession } from '@/lib/auth/server';
import { listTransportVehicles } from '@/lib/api/transport';
import { getLiveMap } from '@/lib/transport/api';
import { GpsDeviceForms } from '../_components/gps-device-forms';
import { LiveMapRefresher, LiveMapSvg } from '../_components/live-map';

export const dynamic = 'force-dynamic';

export default async function TransportLivePage() {
  await requireSession();
  const [live, vehicles] = await Promise.all([getLiveMap(), listTransportVehicles()]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Live map</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {live.honestyNote ||
            'Inline SVG projection of lat/lng. OpenStreetMap deep links on each marker. No MapLibre or Leaflet.'}
        </p>
      </div>
      <LiveMapRefresher />
      <LiveMapSvg vehicles={live.vehicles} stops={live.stops} />
      <ul className="text-sm text-muted-foreground" role="list">
        {live.vehicles.map((v) => (
          <li key={v.vehicleId} data-testid="transport-live-bus">
            {v.registrationNumber ?? v.vehicleId.slice(0, 8)} · {v.latitude.toFixed(4)},{' '}
            {v.longitude.toFixed(4)} ·{' '}
            <a href={v.osmUrl} className="underline-offset-4 hover:underline">
              OpenStreetMap
            </a>
          </li>
        ))}
      </ul>
      <GpsDeviceForms vehicles={vehicles} />
    </div>
  );
}
