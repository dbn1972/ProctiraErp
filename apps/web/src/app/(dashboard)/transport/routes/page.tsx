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
import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { hasDashboardDomainRouteAccess } from '@/lib/auth/domain-route-access';
import { listTransportRoutesWithTotal } from '@/lib/api/transport';
import { listCountCopy } from '../_components/list-count';

export const dynamic = 'force-dynamic';

export default async function TransportRoutesPage() {
  // T-D1: check before any transport or student-directory read.
  if (!(await hasDashboardDomainRouteAccess('transport', '/transport'))) {
    return <RouteAccessDenied />;
  }
  const list = await listTransportRoutesWithTotal();
  const routes = list.items;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transport routes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bus and van routes serving your campuses.
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
              : listCountCopy(list, { one: 'route', many: 'routes' }, ' for this tenant')}
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
                    <p className="mt-1">
                      <Link
                        href={`/transport/routes/${route.id}/stops`}
                        className="text-xs font-medium underline-offset-4 hover:underline"
                      >
                        Manage stops
                      </Link>
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
