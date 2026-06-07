import Link from 'next/link';
import { Plus } from 'lucide-react';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
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

  return (
    <>
      <PageHeader
        title="Tenants"
        description="Provision, suspend, reactivate, and offboard tenant organisations."
        actions={
          <Button asChild>
            <Link href="/tenants/new">
              <Plus className="me-2 h-4 w-4" /> New tenant
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <div className="border-b border-border p-4">
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
                <TableHead>Active users</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                    No tenants match the current filters.
                  </TableCell>
                </TableRow>
              )}
              {tenants.map((tenant) => (
                <TableRow key={tenant.id}>
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
                  <TableCell>{tenant.activeUsers.toLocaleString()}</TableCell>
                  <TableCell>{formatDate(tenant.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
