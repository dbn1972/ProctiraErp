import Link from 'next/link';
import { ArrowLeft, Info } from 'lucide-react';

import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { listBreakGlassRequests } from '@/lib/api/break-glass';
import { listTenants } from '@/lib/api/tenants';
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
  const [{ requests }, { tenants }] = await Promise.all([
    listBreakGlassRequests(),
    listTenants(),
  ]);

  // Resolve tenant IDs to names so raw IDs are never surfaced.
  const tenantName = new Map(tenants.map((t) => [t.id, t.name]));
  function resolveTenant(id: string): string {
    if (id === 'platform') return 'Platform';
    return tenantName.get(id) ?? id;
  }

  const pending = requests.filter((r) => r.status === 'pending_approval');
  const others = requests.filter((r) => r.status !== 'pending_approval');

  return (
    <>
      <PageHeader
        title="Break-glass approval queue"
        description={
          canDecide
            ? 'Review and approve, deny, or revoke active grants. All decisions are audited.'
            : 'Read-only view of the break-glass request queue.'
        }
        actions={
          <Button asChild variant="secondary">
            <Link href="/break-glass">
              <ArrowLeft className="me-2 h-4 w-4" /> New request
            </Link>
          </Button>
        }
      />

      {searchParams?.submitted && (
        <Alert variant="success" className="mb-6">
          <AlertDescription>
            Request <code>{searchParams.submitted}</code> submitted. The security
            team has been notified for approval.
          </AlertDescription>
        </Alert>
      )}

      <Alert variant="info" className="mb-6">
        <Info className="h-4 w-4" />
        <AlertTitle>Approval policy</AlertTitle>
        <AlertDescription>
          You cannot approve your own request. Approvals require a second
          operator and every decision is recorded in the audit log.
        </AlertDescription>
      </Alert>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Pending approval
          <span className="ms-2 inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs tabular-nums text-secondary-foreground">
            {pending.length}
          </span>
        </h2>
        {pending.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No requests are awaiting approval.
            </CardContent>
          </Card>
        ) : (
          pending.map((request) => (
            <Card key={request.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle className="text-base">
                      {request.requester}
                    </CardTitle>
                    <div className="text-sm text-muted-foreground">
                      {resolveTenant(request.targetTenantId)} ·{' '}
                      <span className="capitalize">{request.scope}</span> scope ·{' '}
                      {request.durationMinutes} min
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={request.status} />
                    <span className="font-mono text-xs text-muted-foreground">
                      {request.id}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  <Detail label="Use case" value={request.useCase} />
                  <Detail
                    label="Requested"
                    value={formatDateTime(request.createdAt)}
                  />
                </dl>
                <blockquote className="border-s-2 border-border ps-3 text-sm italic text-muted-foreground">
                  {request.justification}
                </blockquote>
                {canDecide && (
                  <div className="border-t border-border pt-4">
                    <ApprovalActions id={request.id} status={request.status} />
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </section>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>All requests</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {others.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No other break-glass requests.
            </p>
          )}
          {others.map((request) => (
            <div
              key={request.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 last:border-b-0 last:pb-0"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="text-sm font-medium">{request.requester}</div>
                <div className="text-xs text-muted-foreground">
                  {resolveTenant(request.targetTenantId)} ·{' '}
                  <span className="capitalize">{request.scope}</span> ·{' '}
                  {request.useCase}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {request.expiresAt
                    ? `Expires ${formatDateTime(request.expiresAt)}`
                    : formatDateTime(request.createdAt)}
                </span>
                <StatusBadge status={request.status} />
                {canDecide && (
                  <ApprovalActions id={request.id} status={request.status} />
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}
