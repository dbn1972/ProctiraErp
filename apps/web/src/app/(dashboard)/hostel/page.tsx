/**
 * Hostel overview (Server Component).
 */
import Link from 'next/link';
import { BedDouble, Building2, CalendarDays, Users } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listHostels } from '@/lib/api/hostel';
import { NewHostelForm } from './_components/new-hostel-form';

export const dynamic = 'force-dynamic';

export default async function HostelOverviewPage() {
  await requireSession();
  const hostels = await listHostels();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Hostel</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Occupancy, bed assignments, leave requests, and visitor logs.
        </p>
      </div>

      <NewHostelForm />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hostels</CardTitle>
          <CardDescription>
            {hostels.length === 0
              ? 'No hostels yet.'
              : `${hostels.length} hostel${hostels.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hostels.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No hostels yet.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {hostels.map((hostel) => (
                <li key={hostel.id} className="py-3 first:pt-0 last:pb-0" data-testid="hostel-row">
                  <p className="text-sm font-medium text-foreground">
                    {hostel.name}{' '}
                    <span className="font-normal text-muted-foreground">({hostel.code})</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    capacity {hostel.capacity} · {hostel.status}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4" aria-hidden="true" />
              Structure
            </CardTitle>
            <CardDescription>Blocks, rooms, and beds</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/hostel/structure">Manage structure</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BedDouble className="h-4 w-4" aria-hidden="true" />
              Assignments
            </CardTitle>
            <CardDescription>Bed allocations by student</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/hostel/assignments">Open assignments</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              Leaves
            </CardTitle>
            <CardDescription>Approved leave requests</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/hostel/leaves">Open leaves</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" aria-hidden="true" />
              Visitors
            </CardTitle>
            <CardDescription>Guest register by hostel</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/hostel/visitors">Open visitors</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
