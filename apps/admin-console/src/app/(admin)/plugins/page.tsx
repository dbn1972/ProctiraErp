import Link from 'next/link';
import { Eye } from 'lucide-react';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StubDataBanner } from '@/components/stub-data-banner';
import { StatusBadge } from '@/components/ui/status-badge';
import { listPlugins } from '@/lib/api/plugins';
import { requireRole } from '@/lib/auth/server';
import { formatDate } from '@/lib/utils';

export default async function PluginsPage() {
  await requireRole('plugins', '/plugins');
  const { plugins, source } = await listPlugins();

  const reviewQueue = plugins.filter((p) => p.status === 'submitted' || p.status === 'in_review');
  const reviewed = plugins.filter((p) => p.status !== 'submitted' && p.status !== 'in_review');

  return (
    <>
      <PageHeader
        title="Plugin marketplace"
        description="Third-party submissions are sandboxed and manually reviewed before any tenant can install them. Decide approve / reject / revoke / disable."
      />

      <StubDataBanner source={source} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Review queue
          <span className="ms-2 inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs tabular-nums text-secondary-foreground">
            {reviewQueue.length}
          </span>
        </h2>
        {reviewQueue.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No plugins are awaiting review.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {reviewQueue.map((plugin) => (
              <Card key={plugin.id} className="flex flex-col">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle className="text-base">
                        <Link href={`/plugins/${plugin.id}`} className="hover:underline">
                          {plugin.name}
                        </Link>{' '}
                        <span className="font-mono text-xs font-normal text-muted-foreground">
                          v{plugin.version}
                        </span>
                      </CardTitle>
                      <CardDescription>
                        {plugin.vendor} · {plugin.category}
                      </CardDescription>
                    </div>
                    <StatusBadge status={plugin.status} />
                  </div>
                </CardHeader>
                <CardContent className="flex-1 space-y-4">
                  <p className="text-sm text-muted-foreground">{plugin.description}</p>
                  <div>
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Requested scopes
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {plugin.permissions.map((perm) => (
                        <span
                          key={perm}
                          className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-xs text-secondary-foreground"
                        >
                          {perm}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Submitted {formatDate(plugin.submittedAt)}</span>
                    <Link
                      href={`/plugins/${plugin.id}`}
                      className="font-medium text-[hsl(var(--accent))] hover:underline"
                    >
                      Review →
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Reviewed plugins</CardTitle>
          <CardDescription>
            {reviewed.length} submission{reviewed.length === 1 ? '' : 's'} that have been decided.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviewed.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                    No reviewed plugins yet.
                  </TableCell>
                </TableRow>
              )}
              {reviewed.map((plugin) => (
                <TableRow key={plugin.id} className="group">
                  <TableCell>
                    <Link
                      href={`/plugins/${plugin.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {plugin.name}
                    </Link>
                  </TableCell>
                  <TableCell>{plugin.vendor}</TableCell>
                  <TableCell className="font-mono text-xs">{plugin.version}</TableCell>
                  <TableCell>{plugin.category}</TableCell>
                  <TableCell>
                    <StatusBadge status={plugin.status} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {formatDate(plugin.submittedAt)}
                  </TableCell>
                  <TableCell>
                    <Button
                      asChild
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Link href={`/plugins/${plugin.id}`} aria-label={`View ${plugin.name}`}>
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
