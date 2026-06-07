import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/status-badge';
import { listPlugins } from '@/lib/api/plugins';
import { requireRole } from '@/lib/auth/server';
import { formatDate } from '@/lib/utils';

export default async function PluginsPage() {
  await requireRole('plugins', '/plugins');
  const { plugins } = await listPlugins();

  return (
    <>
      <PageHeader
        title="Plugin marketplace"
        description="Review submitted plugins and decide approve / revoke / disable."
      />

      <Card>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {plugins.map((plugin) => (
                <TableRow key={plugin.id}>
                  <TableCell>
                    <Link
                      href={`/plugins/${plugin.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {plugin.name}
                    </Link>
                  </TableCell>
                  <TableCell>{plugin.vendor}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {plugin.version}
                  </TableCell>
                  <TableCell>{plugin.category}</TableCell>
                  <TableCell>
                    <StatusBadge status={plugin.status} />
                  </TableCell>
                  <TableCell>{formatDate(plugin.submittedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
