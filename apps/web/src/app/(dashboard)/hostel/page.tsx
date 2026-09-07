/**
 * Hostel overview (Server Component).
 */
import Link from 'next/link';
import { BedDouble, CalendarDays, Users } from 'lucide-react';

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

export default async function HostelOverviewPage() {
  await requireSession();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Hostel</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Occupancy, assignments, leaves, and visitors. Gateway plugin: `/api/v1/hostel`.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
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
