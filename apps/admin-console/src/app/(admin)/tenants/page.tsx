import Link from 'next/link';
import { Building2, CircleDot, Eye, PauseCircle, Plus, Clock } from 'lucide-react';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/status-badge';
import { TenantsFilter } from './tenants-filter';
import { listTenants, type TenantStatus } from '@/lib/api/tenants';
import { requireRole } from '@/lib/auth/server';
import { formatDate } from '@/lib/utils';

const VALID_STATUSES: ReadonlyArray<TenantStatus | 'all'> = [
  'all',
  'provisioning',
  'active',
  'suspended',
  'decommissioning',
  'archived',
];

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: { status?: string; q?: string };
}) {
  await requireRole('tenants', '/tenants');

  const statusParam = (searchParams?.status ?? 'all') as TenantStatus | 'all';
  const status = (VALID_STATUSES as ReadonlyArray<string>).includes(statusParam)
    ? statusParam
    : 'all';
  const search = searchParams?.q ?? '';

  const { tenants } = await listTenants({ status, search });

  // Unfiltered counts for the KPI row (real, derived only).
  const { tenants: allTenants } = await listTenants();
  const activeCount = allTenants.filter((t) => t.status === 'active').length;
  const provisioningCount = allTenants.filter(
    (t) => t.status === 'provisioning',
  ).length;
  const suspendedCount = allTenants.filter(
    (t) => t.status === 'suspended',
  ).length;

  return (
    <>
      <PageHeader
        title="Tenants"
        description="School district organisations running on the platform. Provision, suspend, reactivate, and offboard here."
        actions={
          <Button asChild>
            <Link href="/tenants/new">
              <Plus className="me-2 h-4 w-4" /> New tenant
            </Link>
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile title="Total tenants" value={allTenants.length} icon={Building2} />
        <StatTile title="Active" value={activeCount} icon={CircleDot} />
        <StatTile title="Provisioning" value={provisioningCount} icon={Clock} />
        <StatTile title="Suspended" value={suspendedCount} icon={PauseCircle} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All tenants</CardTitle>
          <CardDescription>
            {tenants.length} organisation{tenants.length === 1 ? '' : 's'} match
            the current filters.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="border-b border-border px-6 pb-4">
            <TenantsFilter status={status} search={search} />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Region</TableHead>
                <TableHead className="text-end">Active users</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-12">
                    No tenants match the current filters.
                  </TableCell>
                </TableRow>
              )}
              {tenants.map((tenant) => (
                <TableRow key={tenant.id} className="group">
                  <TableCell>
                    <Link
                      href={`/tenants/${tenant.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {tenant.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {tenant.slug}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={tenant.status} />
                  </TableCell>
                  <TableCell className="capitalize">{tenant.plan}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {tenant.region}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {tenant.activeUsers.toLocaleString()}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {formatDate(tenant.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Button
                      asChild
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Link
                        href={`/tenants/${tenant.id}`}
                        aria-label={`View ${tenant.name}`}
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
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

function StatTile({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: number;
  icon: typeof Building2;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {title}
          </div>
          <div className="text-3xl font-extrabold tracking-tight tabular-nums text-foreground">
            {value}
          </div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  );
}
