/**
 * Hostel assignments (Server Component).
 */
import Link from 'next/link';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listHostelAssignments } from '@/lib/api/hostel';
import { NewHostelAssignmentForm } from '../_components/new-assignment-form';

export const dynamic = 'force-dynamic';

export default async function HostelAssignmentsPage() {
  await requireSession();
  const assignments = await listHostelAssignments();

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Assignments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Student bed assignments via GET/POST `/hostel/assignments`.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/hostel">Back to hostel</Link>
        </Button>
      </div>

      <NewHostelAssignmentForm />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active assignments</CardTitle>
          <CardDescription>
            {assignments.length === 0
              ? 'No assignments yet.'
              : `${assignments.length} assignment${assignments.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No assignments yet.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {assignments.map((row) => (
                <li key={row.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-medium text-foreground">
                    Student {row.studentId.slice(0, 8)} · bed {row.bedId.slice(0, 8)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    from {row.startDate}
                    {row.endDate ? ` to ${row.endDate}` : ''} ·{' '}
                    {row.isActive ? 'active' : 'inactive'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
