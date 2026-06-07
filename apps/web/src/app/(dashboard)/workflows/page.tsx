/**
 * Workflow definitions list (Server Component).
 *
 * Validates: Requirement 13.1 — workflow definition browse and management.
 */
import Link from 'next/link';
import { GitBranch, Plus } from 'lucide-react';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import {
  listWorkflowDefinitions,
  type WorkflowDefinition,
} from '@/lib/api/workflows';

export const dynamic = 'force-dynamic';

export default async function WorkflowsPage() {
  const definitions = await listWorkflowDefinitions();

  return (
    <section aria-labelledby="workflows-heading" className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 id="workflows-heading" className="text-2xl font-semibold tracking-tight">
            Workflow definitions
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure approval flows for transfers, leaves, and other actions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/workflows/instances">View instances</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/workflows/approvals">My approvals</Link>
          </Button>
          <Button asChild>
            <Link href="/workflows/definitions/new">
              <Plus className="me-2 h-4 w-4" aria-hidden="true" />
              New definition
            </Link>
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">All definitions</CardTitle>
          <CardDescription>
            {definitions.length.toLocaleString()} workflow definitions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {definitions.length === 0 ? (
            <EmptyState />
          ) : (
            <DefinitionsTable items={definitions} />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-12 text-center">
      <GitBranch className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <p className="text-base font-medium">No workflows defined</p>
      <p className="text-sm text-muted-foreground">
        Define an approval flow to start routing requests.
      </p>
      <Button asChild className="mt-2">
        <Link href="/workflows/definitions/new">Create definition</Link>
      </Button>
    </div>
  );
}

function DefinitionsTable({ items }: { items: WorkflowDefinition[] }) {
  return (
    <Table aria-label="Workflow definitions">
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Module</TableHead>
          <TableHead>Version</TableHead>
          <TableHead className="text-right">Steps</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead className="text-end">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((def) => (
          <TableRow key={def.id}>
            <TableCell className="font-medium">
              <Link
                href={`/workflows/definitions/${def.id}`}
                className="text-primary hover:underline"
              >
                {def.name}
              </Link>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{def.module}</Badge>
            </TableCell>
            <TableCell>v{def.version}</TableCell>
            <TableCell className="text-right">{def.steps.length}</TableCell>
            <TableCell>
              {def.active ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}
            </TableCell>
            <TableCell>{def.updatedAt}</TableCell>
            <TableCell className="text-end">
              <Button asChild variant="ghost" size="sm">
                <Link href={`/workflows/definitions/${def.id}`}>View</Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
