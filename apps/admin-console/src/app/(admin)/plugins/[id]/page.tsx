import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { MissingResource } from '@/components/missing-resource';
import { StubDataBanner } from '@/components/stub-data-banner';
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
import { getPlugin } from '@/lib/api/plugins';
import { requireRole } from '@/lib/auth/server';
import { formatDateTime } from '@/lib/utils';

import { PluginDecisionForm } from './decision-form';

export default async function PluginDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireRole('plugins', `/plugins/${params.id}`);
  const { plugin, source } = await getPlugin(params.id);
  if (!plugin) {
    return (
      <MissingResource
        title="Plugin"
        resourceLabel="Plugin"
        id={params.id}
        backHref="/plugins"
        backLabel="Back to marketplace"
      />
    );
  }

  return (
    <>
      <PageHeader
        title={plugin.name}
        description={`${plugin.vendor} · v${plugin.version}`}
        actions={
          <Button asChild variant="outline">
            <Link href="/plugins">Back to marketplace</Link>
          </Button>
        }
      />

      <StubDataBanner source={source} />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <StatusBadge status={plugin.status} />
        <Badge variant="secondary">{plugin.category}</Badge>
        <span className="text-sm text-muted-foreground">
          Submitted {formatDateTime(plugin.submittedAt)}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Manifest review</CardTitle>
            <CardDescription>
              Inspect the requested permissions and the bundle hash.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Description
              </div>
              <p className="mt-1 text-sm">{plugin.description}</p>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Permissions
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {plugin.permissions.map((p) => (
                  <Badge key={p} variant="warning" className="font-mono">
                    {p}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Manifest hash
              </div>
              <code className="mt-1 block break-all rounded bg-muted px-2 py-1 text-xs">
                {plugin.manifestHash}
              </code>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Decision</CardTitle>
            <CardDescription>
              Provide a justification — recorded in the audit log.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PluginDecisionForm pluginId={plugin.id} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
