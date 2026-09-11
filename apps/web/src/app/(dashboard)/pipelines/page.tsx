/**
 * ETL pipelines hub (Wave 10 Option C).
 */
import Link from 'next/link';

import { Button, Card, CardContent } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listPipelines } from '@/lib/api/etl';
import { CreatePipelineForm } from './_components/create-pipeline-form';

export const dynamic = 'force-dynamic';

export default async function PipelinesPage() {
  await requireSession('/pipelines');
  const pipelines = await listPipelines();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">ETL pipelines</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure extract-transform-load pipelines. Metadata persists when Postgres is configured.
        </p>
      </div>
      <CreatePipelineForm />
      <Card>
        <CardContent className="p-6">
          {pipelines.length === 0 ? (
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
