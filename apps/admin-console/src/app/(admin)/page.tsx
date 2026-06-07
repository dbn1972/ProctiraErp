import Link from 'next/link';
import {
  Activity,
  Building2,
  CreditCard,
  Puzzle,
  ShieldAlert,
} from 'lucide-react';

import { PageHeader } from '@/components/layout/page-header';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { listTenants } from '@/lib/api/tenants';
import { listPlugins } from '@/lib/api/plugins';
import { listBreakGlassRequests } from '@/lib/api/break-glass';
import { getSystemHealth } from '@/lib/api/health';
import { listAudit } from '@/lib/api/audit';
import { formatDateTime } from '@/lib/utils';

/** Platform admin dashboard — overview of tenants, plugins, break-glass, health. */
export default async function DashboardPage() {
  const [tenants, plugins, breakGlass, health, audit] = await Promise.all([
    listTenants(),
    listPlugins(),
    listBreakGlassRequests(),
    getSystemHealth(),
    listAudit(),
  ]);

  const activeTenants = tenants.tenants.filter((t) => t.status === 'active').length;
  const pendingPlugins = plugins.plugins.filter(
    (p) => p.status === 'submitted' || p.status === 'in_review',
  ).length;
  const pendingBg = breakGlass.requests.filter(
    (r) => r.status === 'pending_approval',
  ).length;
  const degradedAdapters = health.health.adapters.filter(
    (a) => a.status !== 'healthy',
  ).length;

  return (
    <>
      <PageHeader
        title="Platform overview"
        description="Tenant lifecycle, marketplace queue, break-glass and system health at a glance."
      />

      {(tenants.source === 'stub' || health.source === 'stub') && (
        <Alert variant="info" className="mb-6">
          <AlertTitle>Showing stub data</AlertTitle>
          <AlertDescription>
            One or more upstream services are unreachable. Pages render
            deterministic fixtures so workflows can still be exercised.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatTile
          title="Active tenants"
          value={String(activeTenants)}
          subtitle={`${tenants.tenants.length} total`}
          icon={Building2}
          href="/tenants"
        />
        <StatTile
          title="Pending plugin reviews"
          value={String(pendingPlugins)}
          subtitle={`${plugins.plugins.length} total submissions`}
          icon={Puzzle}
          href="/plugins"
        />
        <StatTile
          title="Open break-glass requests"
          value={String(pendingBg)}
          subtitle={`${breakGlass.requests.length} total`}
          icon={ShieldAlert}
          href="/break-glass/requests"
        />
        <StatTile
          title="Degraded adapters"
          value={String(degradedAdapters)}
          subtitle={`${health.health.adapters.length} monitored`}
          icon={Activity}
          href="/health"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-4 w-4" /> Recent admin actions
            </CardTitle>
            <CardDescription>
              Last platform-level audit events.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {audit.entries.slice(0, 5).map((entry) => (
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
            <Link
              href="/audit"
              className="text-sm font-medium text-[hsl(var(--accent))] hover:underline"
            >
              View full audit log →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4" /> Adapter health
            </CardTitle>
            <CardDescription>Live status of platform adapters.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {health.health.adapters.map((adapter) => (
              <div
                key={adapter.name}
                className="flex items-center justify-between border-b border-border pb-2 last:border-b-0 last:pb-0"
              >
                <div>
                  <div className="font-medium text-sm">{adapter.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {adapter.note}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{adapter.latencyMs}ms</span>
                  <StatusBadge status={adapter.status} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function StatTile({
  title,
  value,
  subtitle,
  icon: Icon,
  href,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: typeof Building2;
  href: string;
}) {
  return (
    <Link href={href}>
      <Card className="transition-shadow hover:shadow-md">
        <CardContent className="flex items-center justify-between p-5">
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {title}
            </div>
            <div className="text-3xl font-semibold tracking-tight text-foreground">
              {value}
            </div>
            <div className="text-xs text-muted-foreground">{subtitle}</div>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
