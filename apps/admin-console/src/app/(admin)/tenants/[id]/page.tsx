import { notFound } from 'next/navigation';
import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { getTenant } from '@/lib/api/tenants';
import { listAudit } from '@/lib/api/audit';
import { requireRole } from '@/lib/auth/server';
import { formatDateTime, formatDate } from '@/lib/utils';

import { TenantLifecycleActions } from './lifecycle-actions';

export default async function TenantDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { provisioned?: string };
}) {
  await requireRole('tenants', `/tenants/${params.id}`);
  const tenant = await getTenant(params.id);
  if (!tenant) notFound();

  const auditQuery = await listAudit({ tenantId: tenant.id });

  return (
    <>
      <PageHeader
        title={tenant.name}
        description={`Tenant ${tenant.slug} · ${tenant.region}`}
        actions={
          <Button asChild variant="outline">
            <Link href="/tenants">Back to list</Link>
          </Button>
        }
      />

      {searchParams?.provisioned === '1' && (
        <Alert variant="success" className="mb-6">
          <AlertDescription>
            Tenant provisioning request accepted. The tenant will become active
            once background workers complete setup.
          </AlertDescription>
        </Alert>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <StatusBadge status={tenant.status} />
        <Badge variant="secondary" className="capitalize">
          {tenant.plan}
        </Badge>
        <span className="text-sm text-muted-foreground">
          Created {formatDate(tenant.createdAt)} · {tenant.activeUsers.toLocaleString()} active users
        </span>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="entitlements">Entitlements</TabsTrigger>
          <TabsTrigger value="branding">Branding</TabsTrigger>
          <TabsTrigger value="access-log">Access log</TabsTrigger>
          <TabsTrigger value="actions">Actions</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardHeader>
              <CardTitle>Tenant overview</CardTitle>
              <CardDescription>Summary of the tenant configuration.</CardDescription>
            </CardHeader>
            <CardContent>
              <DefinitionList
                items={[
                  ['Tenant ID', tenant.id],
                  ['Slug', tenant.slug],
                  ['Plan', tenant.plan],
                  ['Region', tenant.region],
                  ['Status', tenant.status],
                  ['Primary contact', tenant.contactEmail],
                  ['Active users', tenant.activeUsers.toLocaleString()],
                  ['Created', formatDateTime(tenant.createdAt)],
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="plan">
          <Card>
            <CardHeader>
              <CardTitle>Plan: {tenant.plan}</CardTitle>
              <CardDescription>
                Subscription tier and quotas. Edit globally from the Plans
                section.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                This tenant uses the <strong className="capitalize">{tenant.plan}</strong> plan.
                See <Link href={`/plans/plan_${tenant.plan}`} className="font-medium text-[hsl(var(--accent))] hover:underline">plan details</Link> to manage tier quotas and entitlement defaults.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="entitlements">
          <Card>
            <CardHeader>
              <CardTitle>Active entitlements</CardTitle>
              <CardDescription>
                Features enabled for this tenant on top of the plan defaults.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {tenant.entitlements.map((entitlement) => (
                <Badge key={entitlement} variant="info">
                  {entitlement}
                </Badge>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="branding">
          <Card>
            <CardHeader>
              <CardTitle>Branding & themes</CardTitle>
              <CardDescription>
                Theme assignments are reviewed in the <Link className="font-medium text-[hsl(var(--accent))] hover:underline" href="/themes">themes</Link> section.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              No theme customisations recorded for this tenant.
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="access-log">
          <Card>
            <CardHeader>
              <CardTitle>Access log</CardTitle>
              <CardDescription>
                Recent audit events scoped to this tenant.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {auditQuery.entries.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No recent audit events.
                </p>
              )}
              {auditQuery.entries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start justify-between border-b border-border pb-3 last:border-b-0 last:pb-0"
                >
                  <div className="space-y-1">
                    <div className="font-medium text-sm">{entry.action}</div>
                    <div className="text-xs text-muted-foreground">
                      {entry.actor} → {entry.resource}
                    </div>
                    {entry.reason && (
                      <div className="text-xs text-muted-foreground italic">
                        {entry.reason}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDateTime(entry.timestamp)}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="actions">
          <Card>
            <CardHeader>
              <CardTitle>Lifecycle actions</CardTitle>
              <CardDescription>
                All actions are logged with the operator identity and a written
                justification.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TenantLifecycleActions
                tenantId={tenant.id}
                status={tenant.status}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

function DefinitionList({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">
            {label}
          </dt>
          <dd className="text-sm font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
