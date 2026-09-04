/**
 * Student transport assignments (Server Component).
 *
 * Layout per redesign/web/transport-assignments.html:
 *  - Page head
 *  - Assignments table (student, route, stop, dates, active flag)
 */
import Link from 'next/link';
import { Users } from 'lucide-react';

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
  listStudentAssignments,
  type StudentRouteAssignment,
} from '@/lib/api/transport';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

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

export default async function TransportAssignmentsPage({ searchParams }: PageProps) {
  const routeId = readStr(searchParams, 'routeId').trim() || undefined;
  const assignments = await listStudentAssignments({
    routeId,
  });
  const activeCount = assignments.filter((a) => a.isActive).length;

  return (
    <section aria-labelledby="assignments-heading" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="assignments-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Student route assignments
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {assignments.length.toLocaleString()} assignment
            {assignments.length === 1 ? '' : 's'}
            {activeCount > 0
              ? ` · ${activeCount.toLocaleString()} active`
              : ' · assign students to a route and stop'}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/transport/routes">View routes</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/transport">← Transport overview</Link>
          </Button>
        </div>
      </div>

      {assignments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Users className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <p className="text-base font-medium">No student assignments</p>
            <p className="text-sm text-muted-foreground">
              Assignments will appear here once students are linked to routes.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <AssignmentsTable items={assignments} />
            </div>
            <div className="border-t px-4 py-3 text-sm text-muted-foreground">
              Showing{' '}
              <span className="font-semibold text-foreground">
                1–{assignments.length}
              </span>{' '}
              of{' '}
              <span className="font-semibold text-foreground">
                {assignments.length}
              </span>{' '}
              assignments
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function AssignmentsTable({ items }: { items: StudentRouteAssignment[] }) {
  return (
    <Table aria-label="Student route assignments">
      <TableHeader>
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableHead className="ps-4 font-semibold">Student</TableHead>
          <TableHead className="font-semibold">Route</TableHead>
          <TableHead className="font-semibold">Stop</TableHead>
          <TableHead className="font-semibold">Start</TableHead>
          <TableHead className="font-semibold">End</TableHead>
          <TableHead className="pe-4 font-semibold">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((assignment) => (
          <TableRow key={assignment.id}>
            <TableCell className="ps-4 font-mono text-sm">
              {assignment.studentId}
            </TableCell>
            <TableCell>
              <Link
                href={`/transport/routes/${assignment.routeId}`}
                className="font-mono text-sm text-foreground hover:underline"
              >
                {assignment.routeId}
              </Link>
            </TableCell>
            <TableCell className="font-mono text-sm text-muted-foreground">
              {assignment.stopId ?? '—'}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {assignment.startDate}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {assignment.endDate ?? '—'}
            </TableCell>
            <TableCell className="pe-4">
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
                  assignment.isActive
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                    : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
                )}
              >
                {assignment.isActive ? 'Active' : 'Inactive'}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
