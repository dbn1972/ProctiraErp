import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export default async function TransportVehiclesPage() {
  await requireSession();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Vehicles</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fleet registry via `/api/v1/transport/vehicles`.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fleet</CardTitle>
          <CardDescription>No vehicles loaded yet.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground" role="status">
            Empty fleet.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
