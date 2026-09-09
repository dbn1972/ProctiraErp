/**
 * Tenant lifecycle — provisioning / suspension / decommission register
 * (Server Component, G-727).
 *
 * Reads `GET /api/v1/tenant-lifecycle` (platform scope). State transitions
 * (suspend / reactivate / decommission) are deliberately not exposed as
 * one-click buttons here: they are break-glass operations that the platform
 * console performs with a reason and dual control.
 */
import {
  Badge,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { DocumentTitle } from '@/components/DocumentTitle';
import {
  buildHref,
  PlatformPagination,
  PlatformSurfaceState,
  readPage,
  readParam,
  type SearchParams,
} from '@/components/platform/PlatformSurfaceState';
import { listTenants, type TenantSummary } from '@/lib/api/platform.server';
import { EmptyState } from '@/components/page';

export const dynamic = 'force-dynamic';

const STATUSES = ['provisioning', 'active', 'suspended', 'decommissioned'] as const;

const STATUS_VARIANT: Record<
  string,
  'success' | 'warning' | 'destructive' | 'secondary' | 'outline'
> = {
  provisioning: 'outline',
  active: 'success',
  suspended: 'warning',
  decommissioned: 'destructive',
};

const INPUT_CLASS = 'h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(d);
}

export default async function TenantLifecyclePage(props: { searchParams?: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const status = readParam(searchParams, 'status');
  const region = readParam(searchParams, 'region');
  const search = readParam(searchParams, 'search');
  const page = readPage(searchParams);

  const result = await listTenants({ status, region, search, page, pageSize: 20 });
  const tenants = result.data;
  const filtered = Boolean(status ?? region ?? search);

  const counts = tenants.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section
      aria-labelledby="tenant-lifecycle-heading"
      className="space-y-6"
      data-testid="tenant-lifecycle-page"
    >
      <DocumentTitle pageTitle="Tenant lifecycle" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="tenant-lifecycle-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Tenant lifecycle
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Provisioning, suspension and decommission state for every tenant on this platform.
          </p>
        </div>
        {tenants.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Status summary for this page">
            {STATUSES.filter((s) => counts[s]).map((s) => (
              <li key={s}>
                <Badge variant={STATUS_VARIANT[s] ?? 'secondary'}>
                  {counts[s]?.toLocaleString()} {s}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <PlatformSurfaceState surface="Tenant lifecycle" result={result} />

      <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Filter tenants">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          Search
          <input
            type="search"
            name="search"
            defaultValue={search ?? ''}
            placeholder="Name or slug"
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          Status
          <select name="status" defaultValue={status ?? ''} className={INPUT_CLASS}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          Region
          <input
            name="region"
            defaultValue={region ?? ''}
            placeholder="e.g. ap-south-1"
            className={INPUT_CLASS}
          />
        </label>
        <button
          type="submit"
          className="h-9 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          Apply
        </button>
        {filtered ? (
          <a
            href="/tenant-lifecycle"
            className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm font-semibold text-foreground"
          >
            Clear
          </a>
        ) : null}
      </form>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {tenants.length === 0 ? (
            <EmptyState
              title={filtered ? 'No tenants match these filters' : 'No tenants registered'}
              description={
                filtered
                  ? 'Clear the filters to see every tenant.'
                  : 'Tenants are provisioned through the install wizard or the tenant-lifecycle API.'
              }
            />
          ) : (
            <Table aria-label="Tenants">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="ps-4 font-semibold">Tenant</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="font-semibold">Plan</TableHead>
                  <TableHead className="font-semibold">Region</TableHead>
                  <TableHead className="font-semibold">Created</TableHead>
                  <TableHead className="font-semibold">Suspended</TableHead>
                  <TableHead className="pe-4 font-semibold">Retention until</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenants.map((tenant) => (
                  <TenantRow key={tenant.id} tenant={tenant} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PlatformPagination
        meta={result.meta}
        itemLabel="tenants"
        hrefFor={(p) => buildHref('/tenant-lifecycle', { status, region, search, page: p })}
      />
    </section>
  );
}

function TenantRow({ tenant }: { tenant: TenantSummary }) {
  return (
    <TableRow data-testid="tenant-row" data-status={tenant.status}>
      <TableCell className="ps-4">
        <p className="font-semibold text-foreground">{tenant.name}</p>
        <p className="font-mono text-[11px] text-muted-foreground">
          {tenant.slug} · {tenant.id}
        </p>
      </TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[tenant.status] ?? 'secondary'}>{tenant.status}</Badge>
      </TableCell>
      <TableCell className="text-sm">{tenant.plan}</TableCell>
      <TableCell className="font-mono text-xs">{tenant.region}</TableCell>
      <TableCell className="whitespace-nowrap text-sm tabular-nums">
        {formatDate(tenant.createdAt)}
      </TableCell>
      <TableCell className="text-sm">
        {tenant.suspendedAt ? (
          <>
            <span className="tabular-nums">{formatDate(tenant.suspendedAt)}</span>
            {tenant.suspendedReason ? (
              <p className="max-w-xs text-[11px] text-muted-foreground">{tenant.suspendedReason}</p>
            ) : null}
          </>
        ) : (
          '—'
        )}
      </TableCell>
      <TableCell className="pe-4 whitespace-nowrap text-sm tabular-nums">
        {tenant.decommissionedAt ? formatDate(tenant.dataRetentionUntil) : '—'}
      </TableCell>
    </TableRow>
  );
}
