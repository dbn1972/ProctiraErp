/**
 * Workflow definitions list (Server Component).
 *
 * Validates: Requirement 13.1 — workflow definition browse and management.
 */
import Link from 'next/link';
import { Eye, ListChecks, Plus, ShieldCheck } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { listWorkflowDefinitions, type WorkflowDefinition } from '@/lib/api/workflows';
import { EmptyState } from '@/components/page';

export const dynamic = 'force-dynamic';

export default async function WorkflowsPage() {
  const definitions = await listWorkflowDefinitions();
  const activeCount = definitions.filter((d) => d.active).length;

  return (
    <section aria-labelledby="workflows-heading" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="workflows-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Workflow definitions
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Approval flows for transfers, leaves, disbursements and other district actions ·{' '}
            {definitions.length.toLocaleString()} definition
            {definitions.length === 1 ? '' : 's'}, {activeCount.toLocaleString()} active
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/workflows/instances">
              <ListChecks className="me-1.5 h-4 w-4" aria-hidden="true" />
              View instances
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/workflows/approvals">
              <ShieldCheck className="me-1.5 h-4 w-4" aria-hidden="true" />
              My approvals
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/workflows/definitions/new">
              <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
              New definition
            </Link>
          </Button>
        </div>
      </div>

      {definitions.length === 0 ? (
        <Card className="overflow-hidden">
          <CardContent>
            <EmptyState
              title="No workflows defined"
              description="Define an approval flow to start routing requests."
              action={
                <Button asChild size="sm">
                  <Link href="/workflows/definitions/new">Create definition</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <DefinitionsTable items={definitions} />
          </CardContent>
        </Card>
      )}
    </section>
  );
}

: { items: WorkflowDefinition[] }) {
  return (
    <Table aria-label="Workflow definitions">
      <TableHeader>
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableHead className="font-semibold">Workflow</TableHead>
          <TableHead className="font-semibold">Module</TableHead>
          <TableHead className="text-end font-semibold">Steps</TableHead>
          <TableHead className="font-semibold">Status</TableHead>
          <TableHead className="font-semibold">Updated</TableHead>
          <TableHead className="text-end font-semibold">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((def) => (
          <TableRow key={def.id} className="group">
            <TableCell>
              <Link
                href={`/workflows/definitions/${def.id}`}
                className="font-semibold text-foreground hover:underline"
              >
                {def.name}
              </Link>
              <p className="text-[11px] text-muted-foreground">v{def.version}</p>
            </TableCell>
            <TableCell>
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
                {def.module}
              </span>
            </TableCell>
            <TableCell className="text-end tabular-nums">{def.steps.length}</TableCell>
            <TableCell>
              <StatusPill active={def.active} />
            </TableCell>
            <TableCell className="text-muted-foreground">{def.updatedAt || '—'}</TableCell>
            <TableCell className="text-end">
              <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  aria-label={`View ${def.name}`}
                >
                  <Link href={`/workflows/definitions/${def.id}`}>
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
      Active
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">
      Inactive
    </span>
  );
}
