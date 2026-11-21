/**
 * ETL pipelines hub (Wave 10 Option C).
 */
import Link from 'next/link';

import { Button, Card, CardContent } from '@proctira/ui/components';
import { listEtlConnections, listPipelines } from '@/lib/api/etl';
import { ListLoadFailure } from '@/components/route-state/list-load-failure';
import { CreatePipelineForm } from './_components/create-pipeline-form';
import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { hasDashboardDomainRouteAccess } from '@/lib/auth/domain-route-access';

export const dynamic = 'force-dynamic';

export default async function PipelinesPage() {
  // A-batch: check before any pipeline read.
  if (!(await hasDashboardDomainRouteAccess('pipelines', '/pipelines'))) {
    return <RouteAccessDenied />;
  }
  const [pipelinesResult, connections] = await Promise.all([listPipelines(), listEtlConnections()]);
  const pipelines = pipelinesResult.ok ? pipelinesResult.items : [];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">ETL pipelines</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure extract-transform-load pipelines. Metadata persists when Postgres is configured.
        </p>
      </div>
      {/* PRC-M109: no create form without a server-managed destination connection. */}
      {connections === null ? (
        <p role="alert" className="text-sm text-destructive" data-testid="etl-connections-error">
          Destination connections could not be loaded, so pipelines cannot be created right now.
        </p>
      ) : connections.length === 0 ? (
        <p className="text-sm text-muted-foreground" role="status" data-testid="etl-no-connections">
          No destination connections are configured. An administrator must register one on the
          server (ETL_DESTINATION_CONNECTIONS) before pipelines can be created.
        </p>
      ) : (
        <CreatePipelineForm connections={connections} />
      )}
      <Card>
        <CardContent className="p-6">
          {!pipelinesResult.ok ? (
            <ListLoadFailure
              kind={pipelinesResult.kind}
              status={pipelinesResult.status}
              returnTo="/pipelines"
            />
          ) : pipelines.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No pipelines yet.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {pipelines.map((p) => (
                <li key={p.id} className="py-3 text-sm">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.source?.type ?? 'source'} → {p.destination?.type ?? 'destination'} ·{' '}
                    {p.enabled ? 'enabled' : 'disabled'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Button asChild variant="outline" size="sm">
        <Link href="/data-warehouse">Data warehouse indicators</Link>
      </Button>
    </div>
  );
}
