/**
 * Health records list (Server Component) — access-controlled.
 *
 * Validates: Requirement 12.1 — health records access control.
 *
 * The route is gated client-side first via the requireSession() check in
 * the dashboard layout, then server-side again here against the role list.
 * The backend health-service enforces RBAC even when the frontend check
 * passes, so this is defence in depth.
 */
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';

import {
  Badge,
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
import { requireSession } from '@/lib/auth/server';
import { canAccessHealthRecords, listHealthRecords } from '@/lib/api/health';

export const dynamic = 'force-dynamic';

export default async function HealthRecordsPage() {
  const session = await requireSession('/health');

  if (!canAccessHealthRecords(session.user.roles)) {
    return <AccessDeniedCard />;
  }

  const records = await listHealthRecords();

  return (
    <section aria-labelledby="health-heading" className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 id="health-heading" className="text-2xl font-semibold tracking-tight">
            Health records
          </h1>
          <p className="text-sm text-muted-foreground">
            Confidential medical information. All access is audited.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/health/special-needs">Special needs</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/health/counselling">Counselling</Link>
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Student health records</CardTitle>
          <CardDescription>
            {records.length.toLocaleString()} records accessible.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {records.length === 0 ? (
            <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              No health records available.
            </p>
          ) : (
            <Table aria-label="Health records">
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Blood type</TableHead>
                  <TableHead>Allergies</TableHead>
                  <TableHead>Chronic conditions</TableHead>
                  <TableHead>Last updated</TableHead>
                  <TableHead className="text-end">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/health/${record.studentId}`}
                        className="text-primary hover:underline"
                      >
                        {record.studentName}
                      </Link>
                    </TableCell>
                    <TableCell>{record.bloodType ?? '—'}</TableCell>
                    <TableCell>
                      {record.allergies?.length ? (
                        <Badge variant="warning">{record.allergies.length}</Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {record.chronicConditions?.length ? (
                        <Badge variant="secondary">{record.chronicConditions.length}</Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>{record.lastUpdated}</TableCell>
                    <TableCell className="text-end">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/health/${record.studentId}`}>View</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function AccessDeniedCard() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-3 space-y-0">
        <div className="rounded-lg bg-destructive/10 p-2 text-destructive">
          <ShieldAlert className="h-6 w-6" aria-hidden="true" />
        </div>
        <div>
          <CardTitle className="text-base">Access denied</CardTitle>
          <CardDescription>
            Your role does not have permission to access health records. Contact your
            administrator if you believe you should have access.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link href="/">Return to dashboard</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
