import { ShieldCheck } from 'lucide-react';

import { PageHeader } from '@/components/layout/page-header';
import { StubDataBanner } from '@/components/stub-data-banner';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/status-badge';
import { listAudit } from '@/lib/api/audit';
import { listTenants } from '@/lib/api/tenants';
import { requireRole } from '@/lib/auth/server';
import { formatDateTime } from '@/lib/utils';

import { AuditFilter } from './audit-filter';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: { q?: string; resourceType?: string; tenantId?: string };
}) {
  await requireRole('audit', '/audit');
  const [auditResult, tenantsResult] = await Promise.all([
    listAudit({
      search: searchParams?.q,
      resourceType: searchParams?.resourceType,
      tenantId: searchParams?.tenantId,
    }),
    listTenants(),
  ]);
  const { entries, source } = auditResult;
  const { tenants } = tenantsResult;

  // Resolve tenant IDs to names so raw UUIDs are never surfaced.
  const tenantName = new Map(tenants.map((t) => [t.id, t.name]));
  function resolveTenant(id: string): string {
    if (id === 'platform') return 'Platform';
    return tenantName.get(id) ?? id;
  }

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Platform-wide record of admin actions, break-glass grants, and lifecycle events."
      />

      <StubDataBanner source={source} />

      <Alert variant="info" className="mb-6">
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Immutable by design</AlertTitle>
        <AlertDescription>
          Entries are append-only. Nothing on this page can be edited or deleted
          — including by platform operators.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
          <CardDescription>
            {entries.length} event{entries.length === 1 ? '' : 's'} · newest
            first.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="border-b border-border px-6 pb-4">
            <AuditFilter
              q={searchParams?.q ?? ''}
              resourceType={searchParams?.resourceType ?? ''}
              tenantId={searchParams?.tenantId ?? ''}
            />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead>Outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                    No audit entries match the current filters.
                  </TableCell>
                </TableRow>
              )}
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {formatDateTime(entry.timestamp)}
                  </TableCell>
                  <TableCell>
                    <div className="text-xs">{entry.actor}</div>
                    {entry.actorRole && (
                      <div className="text-xs text-muted-foreground">
                        {entry.actorRole}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-secondary-foreground">
                      {entry.action}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs font-medium">{entry.resource}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {entry.resourceType}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {resolveTenant(entry.tenantId)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={entry.outcome} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
