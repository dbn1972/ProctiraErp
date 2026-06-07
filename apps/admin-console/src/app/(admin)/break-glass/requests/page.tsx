import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/status-badge';
import { listBreakGlassRequests } from '@/lib/api/break-glass';
import { hasRole } from '@/lib/auth';
import { requireRole } from '@/lib/auth/server';
import { formatDateTime } from '@/lib/utils';

import { ApprovalActions } from './approval-actions';

/**
 * /break-glass/requests — admin queue for the approval chain.
 * Operators with the security role (or platform_admin) can approve / deny / revoke.
 * Other roles see the queue read-only for transparency.
 */
export default async function BreakGlassRequestsPage({
  searchParams,
}: {
  searchParams: { submitted?: string };
}) {
  const session = await requireRole('breakGlassRequest', '/break-glass/requests');
  const canDecide = hasRole(session.user.platformRole, 'breakGlassApprove');
  const { requests } = await listBreakGlassRequests();

  return (
    <>
      <PageHeader
        title="Break-glass approval queue"
        description={
          canDecide
            ? 'Review and approve, deny, or revoke active grants. All decisions are audited.'
            : 'Read-only view of the break-glass request queue.'
        }
      />

      {searchParams?.submitted && (
        <Alert variant="success" className="mb-6">
          <AlertDescription>
            Request <code>{searchParams.submitted}</code> submitted. The
            security team has been notified for approval.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Requester</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Use case</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Expires</TableHead>
                {canDecide && <TableHead>Decision</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={canDecide ? 8 : 7}
                    className="text-center text-muted-foreground py-12"
                  >
                    No break-glass requests at the moment.
                  </TableCell>
                </TableRow>
              )}
              {requests.map((request) => (
                <TableRow key={request.id}>
                  <TableCell className="text-xs">{request.requester}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {request.targetTenantId}
                  </TableCell>
                  <TableCell className="capitalize">{request.scope}</TableCell>
                  <TableCell className="text-xs">{request.useCase}</TableCell>
                  <TableCell>
                    <StatusBadge status={request.status} />
                  </TableCell>
                  <TableCell className="text-xs">
                    {formatDateTime(request.createdAt)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {formatDateTime(request.expiresAt)}
                  </TableCell>
                  {canDecide && (
                    <TableCell>
                      <ApprovalActions
                        id={request.id}
                        status={request.status}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
