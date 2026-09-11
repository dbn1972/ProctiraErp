/**
 * PHI access log viewer (Wave 10 Option B).
 * Admin / health-officer only — aligned with HealthService.listPhiAccessLogs.
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

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
import { requireSession } from '@/lib/auth/server';
import { canAccessPhiAccessLogs, listPhiAccessLogs } from '@/lib/api/health';

export const dynamic = 'force-dynamic';

export default async function PhiAccessPage() {
  const session = await requireSession('/health/phi-access');
  if (!canAccessPhiAccessLogs(session.user.roles ?? [])) {
    return (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        PHI access logs require a health admin or health officer role.
      </p>
    );
  }
  const { rows, accessDenied } = await listPhiAccessLogs();

  return (
    <div className="space-y-6 p-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/health">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Health
        </Link>
      </Button>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">PHI access log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Metadata-only audit of who read sensitive health resources. Payloads are never stored
          here.
        </p>
      </div>
      <Card>
        <CardContent className="p-0">
          {accessDenied ? (
            <p className="p-6 text-sm text-destructive" role="alert">
              Access denied by the health service. Your session role cannot read PHI access logs.
            </p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground" role="status">
              No PHI access events yet.
            </p>
          ) : (
            <Table aria-label="PHI access log">
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">
                      {r.createdAt.slice(0, 19).replace('T', ' ')}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.actorUserId.slice(0, 8)}…
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.studentId.slice(0, 8)}…</TableCell>
                    <TableCell>{r.resourceType}</TableCell>
                    <TableCell>{r.action}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
