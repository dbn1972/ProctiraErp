/**
 * PHI access log viewer (Wave 10 Option B).
 * Admin / health-officer only — aligned with HealthService.listPhiAccessLogs.
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
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
import { ListLoadFailure } from '@/components/route-state/list-load-failure';
import { canAccessPhiAccessLogs, listPhiAccessLogsResult } from '@/lib/api/health';
import { PhiAccessDenied } from '@/lib/auth/health-route-guards';
import { requireSession } from '@/lib/auth/server';
import { personDisplayName, resolveEntityLabel } from '@/lib/entity-label';
import { loadStudentLabelMap } from '@/lib/load-entity-labels';

export const dynamic = 'force-dynamic';

export default async function PhiAccessPage() {
  const session = await requireSession('/health/phi-access');
  if (!canAccessPhiAccessLogs(session.user.roles ?? [])) {
    return <PhiAccessDenied />;
  }
  const result = await listPhiAccessLogsResult();
  const accessDenied = !result.ok && result.kind === 'denied';
  const t = await getTranslations('health');
  // HN-F1 / PRC-M088: resolve each row's student by id; an unresolved one gets the
  // localized fallback (HN-R6), never an id fragment.
  const logRows = result.ok ? result.items : [];
  const studentLabels = await loadStudentLabelMap(logRows.map((r) => r.studentId));
  const rows = logRows.map((r) => ({
    ...r,
    studentName: personDisplayName(studentLabels.get(r.studentId), '', t('unknownStudent')),
  }));

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
          ) : !result.ok ? (
            // HL-O1: a 5xx / network failure is not "No PHI access events yet".
            <ListLoadFailure
              kind={result.kind}
              status={result.status}
              returnTo="/health/phi-access"
            />
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
                    <TableCell>{resolveEntityLabel(r.actorUserId, {}, 'User')}</TableCell>
                    <TableCell>{r.studentName}</TableCell>
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
