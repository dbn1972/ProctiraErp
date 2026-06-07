/**
 * Counselling sessions list — access-controlled.
 *
 * Validates: Requirement 12.1 — counselling sessions tracking.
 */
import { Plus } from 'lucide-react';

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
import {
  canAccessHealthRecords,
  listCounsellingSessions,
  type CounsellingSession,
} from '@/lib/api/health';

export const dynamic = 'force-dynamic';

export default async function CounsellingPage() {
  const session = await requireSession('/health/counselling');

  if (!canAccessHealthRecords(session.user.roles)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Access denied</CardTitle>
          <CardDescription>
            Your role does not have permission to view counselling records.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const sessions = await listCounsellingSessions();

  return (
    <section aria-labelledby="counselling-heading" className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 id="counselling-heading" className="text-2xl font-semibold tracking-tight">
            Counselling sessions
          </h1>
          <p className="text-sm text-muted-foreground">
            Schedule and document student counselling sessions confidentially.
          </p>
        </div>
        <Button>
          <Plus className="me-2 h-4 w-4" aria-hidden="true" />
          Schedule session
        </Button>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Sessions</CardTitle>
          <CardDescription>
            {sessions.length.toLocaleString()} sessions on file.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              No counselling sessions recorded.
            </p>
          ) : (
            <Table aria-label="Counselling sessions">
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Counsellor</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Topic</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.studentName}</TableCell>
                    <TableCell>{s.counsellorName}</TableCell>
                    <TableCell>{s.sessionDate}</TableCell>
                    <TableCell>{s.topic}</TableCell>
                    <TableCell>
                      <SessionStatus status={s.status} />
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

function SessionStatus({ status }: { status: CounsellingSession['status'] }) {
  switch (status) {
    case 'COMPLETED':
      return <Badge variant="success">Completed</Badge>;
    case 'CANCELLED':
      return <Badge variant="destructive">Cancelled</Badge>;
    default:
      return <Badge variant="secondary">Scheduled</Badge>;
  }
}
