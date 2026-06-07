/**
 * Special needs records list — access-controlled.
 *
 * Validates: Requirement 12.1 — special needs tracking.
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
  listSpecialNeeds,
  type SpecialNeedRecord,
} from '@/lib/api/health';

export const dynamic = 'force-dynamic';

export default async function SpecialNeedsPage() {
  const session = await requireSession('/health/special-needs');

  if (!canAccessHealthRecords(session.user.roles)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Access denied</CardTitle>
          <CardDescription>
            Your role does not have permission to view special needs records.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const records = await listSpecialNeeds();

  return (
    <section aria-labelledby="special-needs-heading" className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 id="special-needs-heading" className="text-2xl font-semibold tracking-tight">
            Special needs
          </h1>
          <p className="text-sm text-muted-foreground">
            Track accommodations and individualized education plans (IEPs).
          </p>
        </div>
        <Button>
          <Plus className="me-2 h-4 w-4" aria-hidden="true" />
          New record
        </Button>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">All records</CardTitle>
          <CardDescription>
            {records.length.toLocaleString()} students with special needs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {records.length === 0 ? (
            <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              No special needs records.
            </p>
          ) : (
            <Table aria-label="Special needs records">
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Accommodations</TableHead>
                  <TableHead>IEP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.studentName}</TableCell>
                    <TableCell>{r.category}</TableCell>
                    <TableCell>
                      <SeverityBadge severity={r.severity} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.accommodations.length}</Badge>
                    </TableCell>
                    <TableCell>
                      {r.iepActive ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="secondary">None</Badge>
                      )}
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

function SeverityBadge({ severity }: { severity: SpecialNeedRecord['severity'] }) {
  switch (severity) {
    case 'SEVERE':
      return <Badge variant="destructive">Severe</Badge>;
    case 'MODERATE':
      return <Badge variant="warning">Moderate</Badge>;
    default:
      return <Badge variant="secondary">Mild</Badge>;
  }
}
