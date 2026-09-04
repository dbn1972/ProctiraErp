/**
 * Transport route detail (Server Component).
 *
 * Layout per redesign/web/transport-route-detail.html:
 *  - Page head with status + schedule summary
 *  - Ordered stops table (stopOrder, pickup/dropoff times)
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, MapPinned, Users } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import {
  getTransportRoute,
  listRouteStops,
  type RouteStop,
  type TransportRoute,
  type TransportRouteStatus,
} from '@/lib/api/transport';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

const STATUS_LABELS: Record<TransportRouteStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  suspended: 'Suspended',
};

const STATUS_COLOURS: Record<TransportRouteStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  inactive: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  suspended: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
};

export default async function TransportRouteDetailPage({ params }: PageProps) {
  const route = await getTransportRoute(params.id);
  if (!route) notFound();

  const stops = await listRouteStops(route.id);
  const orderedStops = [...stops].sort((a, b) => a.stopOrder - b.stopOrder);

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/transport/routes">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          All routes
        </Link>
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-3xl font-extrabold tracking-tight text-foreground">
            {route.name}
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold align-middle',
                STATUS_COLOURS[route.status],
              )}
            >
              {STATUS_LABELS[route.status]}
            </span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {route.startLocation} → {route.endLocation}
            {route.distanceKm != null ? ` · ${route.distanceKm} km` : ''}
            {route.estimatedDurationMinutes != null
              ? ` · ${route.estimatedDurationMinutes} min`
              : ''}
            {orderedStops.length > 0
              ? ` · ${orderedStops.length.toLocaleString()} stops`
              : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/transport/assignments?routeId=${route.id}`}>
              <Users className="me-1.5 h-4 w-4" aria-hidden="true" />
              Assignments
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetaCard label="Departure" value={route.departureTime ?? '—'} mono />
        <MetaCard label="Return" value={route.returnTime ?? '—'} mono />
        <MetaCard
          label="Operating days"
          value={
            route.operatingDays.length > 0 ? route.operatingDays.join(', ') : '—'
          }
        />
        <MetaCard
          label="Distance"
          value={route.distanceKm != null ? `${route.distanceKm} km` : '—'}
        />
      </div>

      {route.description ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{route.description}</p>
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Stops &amp; pickup times</CardTitle>
          <CardDescription>
            Ordered by stop sequence
            {route.departureTime ? ` · departs ${route.departureTime}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {orderedStops.length === 0 ? (
            <p className="border-t py-12 text-center text-sm text-muted-foreground">
              No stops configured for this route.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <StopsTable stops={orderedStops} route={route} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetaCard({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p
          className={cn(
            'mt-2 text-base font-semibold text-foreground',
            mono && 'font-mono',
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function StopsTable({
  stops,
  route,
}: {
  stops: RouteStop[];
  route: TransportRoute;
}) {
  return (
    <Table aria-label={`Stops for ${route.name}`}>
      <TableHeader>
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableHead className="ps-4 font-semibold text-end">#</TableHead>
          <TableHead className="font-semibold">Stop</TableHead>
          <TableHead className="font-semibold">Pickup</TableHead>
          <TableHead className="pe-4 font-semibold">Drop-off</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {stops.map((stop) => (
          <TableRow key={stop.id}>
            <TableCell className="ps-4 text-end tabular-nums text-muted-foreground">
              {stop.stopOrder}
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <MapPinned
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="font-medium text-foreground">{stop.name}</span>
              </div>
            </TableCell>
            <TableCell className="font-mono text-sm">
              {stop.pickupTime ?? '—'}
            </TableCell>
            <TableCell className="pe-4 font-mono text-sm">
              {stop.dropoffTime ?? '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
