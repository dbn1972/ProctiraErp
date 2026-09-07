import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listTransportVehicles } from '@/lib/api/transport';
import { NewVehicleForm } from '../_components/new-vehicle-form';

export const dynamic = 'force-dynamic';

export default async function TransportVehiclesPage() {
  await requireSession();
  const vehicles = await listTransportVehicles();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Vehicles</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fleet registry — registration numbers, capacity, and status.
        </p>
      </div>

      <NewVehicleForm />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fleet</CardTitle>
          <CardDescription>
            {vehicles.length === 0
              ? 'No vehicles loaded yet.'
              : `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {vehicles.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              Empty fleet.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {vehicles.map((vehicle) => (
                <li
                  key={vehicle.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="transport-vehicle-row"
                >
                  <p className="text-sm font-medium text-foreground">
                    {vehicle.registrationNumber}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Unknown model'} ·
                    capacity {vehicle.capacity} · {vehicle.status}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
