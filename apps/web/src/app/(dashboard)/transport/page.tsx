/**
 * Transport overview (Server Component).
 */
import Link from 'next/link';
import { Bus, MapPinned, Users } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export default async function TransportOverviewPage() {
  await requireSession();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Transport
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage routes, fleet, and student assignments. Gateway plugin:
          `/api/v1/transport`.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPinned className="h-4 w-4" aria-hidden="true" />
              Routes
            </CardTitle>
            <CardDescription>Stops, schedules, operating days</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/transport/routes">Open routes</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bus className="h-4 w-4" aria-hidden="true" />
              Vehicles
            </CardTitle>
            <CardDescription>Fleet registration and capacity</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/transport/vehicles">Open vehicles</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" aria-hidden="true" />
              Assignments
            </CardTitle>
            <CardDescription>Drivers and student route seats</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/transport/assignments">Open assignments</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
