/**
 * Transport overview (Server Component).
 *
 * Layout per redesign/web/transport-overview.html:
 *  - Page head with quick links to routes / vehicles / assignments
 *  - KPI cards (active routes, fleet size, active assignments, maintenance)
 *  - Routes preview table
 */
import Link from 'next/link';
import {
  Bus,
  Eye,
  Map,
  Route as RouteIcon,
  Users,
  Wrench,
} from 'lucide-react';

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
  listStudentAssignments,
  listTransportRoutes,
  listVehicles,
  type TransportRoute,
  type TransportRouteStatus,
} from '@/lib/api/transport';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

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

export default async function TransportOverviewPage() {
  const [routes, vehicles, assignments] = await Promise.all([
    listTransportRoutes(),
    listVehicles(),
    listStudentAssignments(),
  ]);

  const activeRoutes = routes.filter((r) => r.status === 'active').length;
  const fleetSize = vehicles.length;
  const activeAssignments = assignments.filter((a) => a.isActive).length;
  const maintenanceVehicles = vehicles.filter((v) => v.status === 'maintenance').length;
  const previewRoutes = routes.slice(0, 8);

  return (
    <section aria-labelledby="transport-heading" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="transport-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Transport
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Routes, fleet and student assignments
            {routes.length > 0
              ? ` · ${routes.length.toLocaleString()} routes · ${fleetSize.toLocaleString()} vehicles`
              : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/transport/vehicles">
              <Bus className="me-1.5 h-4 w-4" aria-hidden="true" />
              Vehicles
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/transport/assignments">
              <Users className="me-1.5 h-4 w-4" aria-hidden="true" />
              Assignments
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/transport/routes">
              <Map className="me-1.5 h-4 w-4" aria-hidden="true" />
              All routes
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<RouteIcon className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
          label="Active routes"
          value={activeRoutes.toLocaleString()}
        />
        <KpiCard
          icon={<Bus className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400"
          label="Fleet size"
          value={fleetSize.toLocaleString()}
        />
        <KpiCard
          icon={<Users className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400"
          label="Active assignments"
          value={activeAssignments.toLocaleString()}
        />
        <KpiCard
          icon={<Wrench className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400"
          label="In maintenance"
          value={maintenanceVehicles.toLocaleString()}
        />
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Routes at a glance</CardTitle>
              <CardDescription>
                {routes.length.toLocaleString()} routes configured
                {activeRoutes > 0
                  ? ` · ${activeRoutes.toLocaleString()} active`
                  : null}
              </CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/transport/routes">All routes →</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {previewRoutes.length === 0 ? (
            <p className="border-t py-12 text-center text-sm text-muted-foreground">
              No transport routes yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <RoutesPreviewTable items={previewRoutes} />
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function RoutesPreviewTable({ items }: { items: TransportRoute[] }) {
  return (
    <Table aria-label="Transport routes preview">
      <TableHeader>
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableHead className="ps-4 font-semibold">Route</TableHead>
          <TableHead className="font-semibold">Start → End</TableHead>
          <TableHead className="font-semibold text-end">Distance</TableHead>
          <TableHead className="font-semibold">Departure</TableHead>
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
              {route.operatingDays.length > 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  {route.operatingDays.join(', ')}
                </p>
              ) : null}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {route.startLocation} → {route.endLocation}
            </TableCell>
            <TableCell className="text-end tabular-nums">
              {route.distanceKm != null ? `${route.distanceKm} km` : '—'}
            </TableCell>
            <TableCell className="font-mono text-sm">
              {route.departureTime ?? '—'}
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

function KpiCard({
  icon,
  iconClass,
  label,
  value,
}: {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
              iconClass,
            )}
          >
            {icon}
          </span>
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
        </div>
        <div className="mt-3 text-3xl font-extrabold tabular-nums text-foreground">
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
