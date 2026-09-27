import { Database, HardDrive, KeyRound, Layers, Radio, Zap } from 'lucide-react';

import { PageHeader } from '@/components/layout/page-header';
import { StubDataBanner } from '@/components/stub-data-banner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getSystemHealth, type AdapterHealth } from '@/lib/api/health';
import { requireRole } from '@/lib/auth/server';
import {
  formatSnapshotAge,
  healthSnapshotAgeMs,
  isHealthSnapshotStale,
} from '@/lib/health-snapshot';
import { formatDateTime } from '@/lib/utils';

import { RefreshHealthButton } from './refresh-button';

const CATEGORY_ICON: Record<AdapterHealth['category'], typeof Database> = {
  database: Database,
  cache: Zap,
  storage: HardDrive,
  queue: Layers,
  auth: KeyRound,
  external: Radio,
};

/** /health — adapter status, queue lag, error rates. */
export default async function HealthPage() {
  await requireRole('health', '/health');
  const { health, source } = await getSystemHealth();

  const healthy = health.adapters.filter((a) => a.status === 'healthy').length;
  const degraded = health.adapters.filter((a) => a.status === 'degraded').length;
  const down = health.adapters.filter((a) => a.status === 'down').length;
  const ageMs = healthSnapshotAgeMs(health.generatedAt);
  const stale = isHealthSnapshotStale(health.generatedAt);

  return (
    <>
      <PageHeader
        title="System health"
        description={`Snapshot generated ${formatDateTime(health.generatedAt)}.`}
        actions={<RefreshHealthButton />}
      />

      <StubDataBanner source={source} />

      {stale && ageMs !== null && (
        <Alert variant="warning" className="mb-6">
          <AlertTitle>Snapshot is stale</AlertTitle>
          <AlertDescription>
            This health snapshot is {formatSnapshotAge(ageMs)} old. Refresh to load the latest
            probe.
          </AlertDescription>
        </Alert>
      )}

      {/* Adapter cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {health.adapters.map((adapter) => {
          const Icon = CATEGORY_ICON[adapter.category] ?? Database;
          return (
            <Card key={adapter.name}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="font-semibold">{adapter.name}</span>
                  </div>
                  <StatusBadge status={adapter.status} />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">{adapter.note}</p>
                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    latency{' '}
                    <span className="font-mono font-semibold tabular-nums text-foreground">
                      {adapter.latencyMs}ms
                    </span>
                  </span>
                  <span>
                    checked{' '}
                    <span className="font-mono text-foreground">
                      {formatDateTime(adapter.lastChecked)}
                    </span>
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Queue lag</CardTitle>
              <CardDescription>Backlog depth and message age per queue.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Queue</TableHead>
                    <TableHead className="text-end">Depth</TableHead>
                    <TableHead className="text-end">Age</TableHead>
                    <TableHead className="text-end">Consumers</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {health.queues.map((queue) => (
                    <TableRow key={queue.queue}>
                      <TableCell className="font-mono text-xs">{queue.queue}</TableCell>
                      <TableCell className="text-end tabular-nums">
                        {queue.depth.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-end font-mono text-xs tabular-nums">
                        {queue.ageSeconds}s
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{queue.consumerCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Error rates</CardTitle>
              <CardDescription>Errors per million over the last 5 minutes.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead className="text-end">Rate</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {health.errors.map((error) => (
                    <TableRow key={error.service}>
                      <TableCell className="font-mono text-xs">{error.service}</TableCell>
                      <TableCell className="text-end font-mono text-xs tabular-nums">
                        {error.errorPerMillion.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={error.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* Probe summary */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Probe summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <SummaryRow label="Adapters monitored" value={health.adapters.length} />
            <SummaryRow label="Healthy" value={healthy} status="healthy" />
            <SummaryRow label="Degraded" value={degraded} status="degraded" />
            <SummaryRow label="Down" value={down} status="down" />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function SummaryRow({ label, value, status }: { label: string; value: number; status?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-b-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <span className="text-sm font-semibold tabular-nums text-foreground">{value}</span>
        {status ? <StatusBadge status={status} /> : null}
      </span>
    </div>
  );
}
