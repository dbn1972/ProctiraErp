/**
 * Transport routes list (Server Component).
 *
 * Layout per redesign/web/transport-routes.html:
 *  - Page head
 *  - GET search form (q, status)
 *  - Routes table with start/end, distance, schedule, status
 */
import Link from 'next/link';
import { Eye, Map, Search } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import {
  listTransportRoutes,
  type TransportRoute,
  type TransportRouteStatus,
} from '@/lib/api/transport';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
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

function readStr(
  params: PageProps['searchParams'],
  key: string,
  fallback = '',
): string {
  if (!params) return fallback;
  const v = params[key];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length > 0) return v[0] ?? fallback;
  return fallback;
}

function isRouteStatus(value: string): value is TransportRouteStatus {
  return value === 'active' || value === 'inactive' || value === 'suspended';
}

export default async function TransportRoutesPage({ searchParams }: PageProps) {
  const q = readStr(searchParams, 'q').trim();
  const statusRaw = readStr(searchParams, 'status').trim();
  const status = isRouteStatus(statusRaw) ? statusRaw : undefined;

  const routes = await listTransportRoutes({
    search: q || undefined,
    status,
  });

  return (
    <section aria-labelledby="routes-heading" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="routes-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Routes
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {routes.length.toLocaleString()} route
            {routes.length === 1 ? '' : 's'}
            {q || status ? ' matching filters' : ' · stops, schedule and operating days'}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/transport">← Transport overview</Link>
        </Button>
      </div>

      <form
        method="GET"
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        role="search"
        aria-label="Filter routes"
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <label htmlFor="route-q" className="text-xs font-semibold text-muted-foreground">
            Search
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="route-q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Search by route name or location"
              className="ps-9"
            />
          </div>
        </div>
        <div className="w-full space-y-1.5 sm:w-48">
          <label
            htmlFor="route-status"
            className="text-xs font-semibold text-muted-foreground"
          >
            Status
          </label>
          <select
            id="route-status"
            name="status"
            defaultValue={status ?? ''}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
        <Button type="submit" size="sm" className="shrink-0">
          Filter
        </Button>
      </form>

      {routes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Map className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <p className="text-base font-medium">No routes found</p>
            <p className="text-sm text-muted-foreground">
              {q || status
                ? 'Try adjusting the search or status filter.'
                : 'Routes will appear here once configured.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <RoutesTable items={routes} />
            </div>
            <div className="border-t px-4 py-3 text-sm text-muted-foreground">
              Showing{' '}
              <span className="font-semibold text-foreground">1–{routes.length}</span> of{' '}
              <span className="font-semibold text-foreground">{routes.length}</span> routes
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function RoutesTable({ items }: { items: TransportRoute[] }) {
  return (
    <Table aria-label="Transport routes">
      <TableHeader>
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableHead className="ps-4 font-semibold">Route</TableHead>
          <TableHead className="font-semibold">Start → End</TableHead>
          <TableHead className="font-semibold text-end">Distance</TableHead>
          <TableHead className="font-semibold text-end">Duration</TableHead>
          <TableHead className="font-semibold">Schedule</TableHead>
          <TableHead className="font-semibold">Status</TableHead>
          <TableHead className="pe-4 text-end font-semibold">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((route) => (
          <TableRow key={route.id} className="group">
            <TableCell className="ps-4">
              <Link
                href={`/transport/routes/${route.id}`}
                className="font-semibold text-foreground hover:underline"
              >
                {route.name}
              </Link>
              {route.description ? (
                <p className="line-clamp-1 text-[11px] text-muted-foreground">
                  {route.description}
                </p>
              ) : null}
            </TableCell>
            <TableCell className="text-sm">
              {route.startLocation} → {route.endLocation}
            </TableCell>
            <TableCell className="text-end tabular-nums">
              {route.distanceKm != null ? `${route.distanceKm} km` : '—'}
            </TableCell>
            <TableCell className="text-end tabular-nums">
              {route.estimatedDurationMinutes != null
                ? `${route.estimatedDurationMinutes} min`
                : '—'}
            </TableCell>
            <TableCell>
              <p className="font-mono text-sm">
                {route.departureTime ?? '—'}
                {route.returnTime ? ` / ${route.returnTime}` : ''}
              </p>
              {route.operatingDays.length > 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  {route.operatingDays.join(', ')}
                </p>
              ) : null}
            </TableCell>
            <TableCell>
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
                  STATUS_COLOURS[route.status],
                )}
              >
                {STATUS_LABELS[route.status]}
              </span>
            </TableCell>
            <TableCell className="pe-4">
              <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                <Button asChild variant="ghost" size="icon" className="h-8 w-8 p-0">
                  <Link
                    href={`/transport/routes/${route.id}`}
                    aria-label={`View ${route.name}`}
                  >
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
