/**
 * Transport fleet list (Server Component).
 *
 * Layout per redesign/web/transport-vehicles.html:
 *  - Page head with fleet summary
 *  - Vehicles table (registration, make/model, capacity, documents, status)
 */
import Link from 'next/link';
import { Bus } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import {
  listVehicles,
  type Vehicle,
  type VehicleStatus,
} from '@/lib/api/transport';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<VehicleStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  maintenance: 'Maintenance',
  retired: 'Retired',
};

const STATUS_COLOURS: Record<VehicleStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  inactive: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  maintenance: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  retired: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};

export default async function TransportVehiclesPage() {
  const vehicles = await listVehicles();
  const maintenanceCount = vehicles.filter((v) => v.status === 'maintenance').length;

  return (
    <section aria-labelledby="fleet-heading" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="fleet-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Fleet
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {vehicles.length.toLocaleString()} vehicle
            {vehicles.length === 1 ? '' : 's'}
            {maintenanceCount > 0
              ? ` · ${maintenanceCount.toLocaleString()} in maintenance`
              : ' · insurance and service dates tracked per vehicle'}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/transport">← Transport overview</Link>
        </Button>
      </div>

      {vehicles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Bus className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <p className="text-base font-medium">No vehicles in the fleet</p>
            <p className="text-sm text-muted-foreground">
              Vehicles will appear here once registered.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <VehiclesTable items={vehicles} />
            </div>
            <div className="border-t px-4 py-3 text-sm text-muted-foreground">
              Showing{' '}
              <span className="font-semibold text-foreground">1–{vehicles.length}</span> of{' '}
              <span className="font-semibold text-foreground">{vehicles.length}</span> vehicles
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function VehiclesTable({ items }: { items: Vehicle[] }) {
  return (
    <Table aria-label="Transport fleet">
      <TableHeader>
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableHead className="ps-4 font-semibold">Registration</TableHead>
          <TableHead className="font-semibold">Make / model</TableHead>
          <TableHead className="font-semibold text-end">Capacity</TableHead>
          <TableHead className="font-semibold">Insurance expiry</TableHead>
          <TableHead className="font-semibold">Last service</TableHead>
          <TableHead className="pe-4 font-semibold">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((vehicle) => (
          <TableRow key={vehicle.id}>
            <TableCell className="ps-4">
              <span className="font-mono text-sm font-semibold text-foreground">
                {vehicle.registrationNumber}
              </span>
              {vehicle.year != null ? (
                <p className="text-[11px] text-muted-foreground">{vehicle.year}</p>
              ) : null}
            </TableCell>
            <TableCell>
              {[vehicle.make, vehicle.model].filter(Boolean).join(' ') || '—'}
            </TableCell>
            <TableCell className="text-end tabular-nums">{vehicle.capacity}</TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {vehicle.insuranceExpiry ?? '—'}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {vehicle.lastServiceDate ?? '—'}
            </TableCell>
            <TableCell className="pe-4">
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
                  STATUS_COLOURS[vehicle.status],
                )}
              >
                {STATUS_LABELS[vehicle.status]}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
