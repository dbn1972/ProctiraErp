import Link from 'next/link';
import { Plus } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listTransportRoutes } from '@/lib/api/transport';

export const dynamic = 'force-dynamic';

export default async function TransportRoutesPage() {
  await requireSession();
  const routes = await listTransportRoutes();

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transport routes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live list from `/api/v1/transport/routes`.
          </p>
        </div>
        <Button asChild>
          <Link href="/transport/routes/new">
            <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
            New route
          </Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Routes</CardTitle>
          <CardDescription>
            {routes.length === 0
              ? 'No routes yet — create the first corridor for this tenant.'
              : `${routes.length} route${routes.length === 1 ? '' : 's'} for this tenant.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {routes.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No routes yet.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {routes.map((route) => (
                <li
                  key={route.id}
                  className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0"
                  data-testid="transport-route-row"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{route.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {route.startLocation} → {route.endLocation}
                      {route.departureTime ? ` · departs ${route.departureTime}` : ''}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {route.operatingDays.join(', ')} · {route.status}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
