import { PageHeader } from '@/components/layout/page-header';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getSystemHealth } from '@/lib/api/health';
import { requireRole } from '@/lib/auth/server';
import { formatDateTime } from '@/lib/utils';

/** /health — adapter status, queue lag, error rates. */
export default async function HealthPage() {
  await requireRole('health', '/health');
  const { health, source } = await getSystemHealth();

  return (
    <>
      <PageHeader
        title="System health"
        description={`Snapshot generated ${formatDateTime(health.generatedAt)}${source === 'stub' ? ' (stub data)' : ''}.`}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Adapters</CardTitle>
            <CardDescription>Database, cache, queue, storage.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.adapters.map((adapter) => (
                  <TableRow key={adapter.name}>
                    <TableCell>
                      <div className="font-medium text-sm">{adapter.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {adapter.note}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={adapter.status} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {adapter.latencyMs}ms
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Queue lag</CardTitle>
            <CardDescription>Backlog depth and message age per queue.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Queue</TableHead>
                  <TableHead>Depth</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead>Consumers</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.queues.map((queue) => (
                  <TableRow key={queue.queue}>
                    <TableCell className="font-mono text-xs">
                      {queue.queue}
                    </TableCell>
                    <TableCell>{queue.depth.toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {queue.ageSeconds}s
                    </TableCell>
                    <TableCell>{queue.consumerCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Error rates</CardTitle>
            <CardDescription>Errors per million over last 5 minutes.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.errors.map((error) => (
                  <TableRow key={error.service}>
                    <TableCell className="font-mono text-xs">
                      {error.service}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
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
    </>
  );
}
