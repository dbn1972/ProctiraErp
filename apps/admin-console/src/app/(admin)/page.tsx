import Link from 'next/link';
import {
  Activity,
  Building2,
  FileText,
  Plus,
  Puzzle,
  ShieldAlert,
} from 'lucide-react';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
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
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href="/audit">
                <FileText className="me-2 h-4 w-4" /> Audit log
              </Link>
            </Button>
            <Button asChild>
              <Link href="/tenants/new">
                <Plus className="me-2 h-4 w-4" /> New tenant
              </Link>
            </Button>
          </>
        }
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

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Recent admin actions — timeline */}
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-4 w-4" /> Recent admin actions
              </CardTitle>
              <CardDescription>Last platform-level audit events.</CardDescription>
            </div>
            <Link
              href="/audit"
              className="whitespace-nowrap text-sm font-medium text-[hsl(var(--accent))] hover:underline"
            >
              Full audit log →
            </Link>
          </CardHeader>
          <CardContent>
            <ul className="space-y-4">
              {audit.entries.slice(0, 5).map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-start gap-3 border-b border-border pb-4 last:border-b-0 last:pb-0"
                >
                  <span
                    className={`mt-1 inline-flex h-2 w-2 shrink-0 rounded-full ${
                      entry.outcome === 'failure'
                        ? 'bg-[hsl(var(--destructive))]'
                        : 'bg-[hsl(var(--success))]'
                    }`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 space-y-1">
                    <div className="text-sm">
                      <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-secondary-foreground">
                        {entry.action}
                      </span>{' '}
                      <span className="font-medium text-foreground">
                        {entry.resource}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {entry.actor} · {formatDateTime(entry.timestamp)}
                      {entry.reason ? ` · ${entry.reason}` : ''}
                    </div>
                  </div>
                </li>
              ))}
              {audit.entries.length === 0 && (
                <li className="py-6 text-center text-sm text-muted-foreground">
                  No recent admin actions.
                </li>
              )}
            </ul>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* Adapter health */}
          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div className="space-y-1.5">
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-4 w-4" /> Adapter health
                </CardTitle>
                <CardDescription>Live status of platform adapters.</CardDescription>
              </div>
              <Link
                href="/health"
                className="whitespace-nowrap text-sm font-medium text-[hsl(var(--accent))] hover:underline"
              >
                Details →
              </Link>
            </CardHeader>
            <CardContent className="space-y-3">
              {health.health.adapters.map((adapter) => (
                <div
                  key={adapter.name}
                  className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-b-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {adapter.name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {adapter.note}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono tabular-nums">
                      {adapter.latencyMs}ms
                    </span>
                    <StatusBadge status={adapter.status} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Queue snapshot */}
          <Card>
            <CardHeader>
              <CardTitle>Queues today</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <QueueRow
                label="Plugin reviews waiting"
                value={pendingPlugins}
              />
              <QueueRow
                label="Break-glass requests"
                value={breakGlass.requests.length}
              />
              <Button asChild variant="secondary" className="w-full">
                <Link href="/break-glass/requests">
                  Review break-glass queue
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function QueueRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2 last:border-b-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-foreground">
        {value}
      </span>
    </div>
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
            <div className="text-3xl font-extrabold tracking-tight tabular-nums text-foreground">
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
