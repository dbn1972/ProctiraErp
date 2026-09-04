/**
 * Workflow definitions list (Server Component).
 *
 * Layout per redesign/web/workflows-list.html:
 *  - Page head with Instances / Approvals / New definition CTAs
 *  - Status tabs (All / Active / Inactive)
 *  - Definitions table with module, steps, status, actions
 *
 * Validates: Requirement 13.1 — workflow definition browse and management.
 */
import Link from 'next/link';
import {
  Eye,
  GitBranch,
  ListChecks,
  MoreVertical,
  Pencil,
  Plus,
  ShieldCheck,
} from 'lucide-react';

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
import {
  listPendingApprovals,
  listWorkflowDefinitions,
  listWorkflowInstances,
  type WorkflowDefinition,
} from '@/lib/api/workflows';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type StatusFilter = 'all' | 'active' | 'inactive';

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function resolveFilter(raw: string | undefined): StatusFilter {
  if (raw === 'active' || raw === 'inactive') return raw;
  return 'all';
}

export default async function WorkflowsPage({ searchParams }: PageProps) {
  const filter = resolveFilter(single(searchParams?.status));
  const [definitions, instances, approvals] = await Promise.all([
    listWorkflowDefinitions(),
    listWorkflowInstances(),
    listPendingApprovals(),
  ]);

  const activeCount = definitions.filter((d) => d.active).length;
  const inactiveCount = definitions.length - activeCount;
  const pendingInstances = instances.filter((i) => i.status === 'PENDING').length;

  const filtered =
    filter === 'active'
      ? definitions.filter((d) => d.active)
      : filter === 'inactive'
        ? definitions.filter((d) => !d.active)
        : definitions;

  const tabs: Array<{ key: StatusFilter; label: string; count: number }> = [
    { key: 'all', label: 'All', count: definitions.length },
    { key: 'active', label: 'Active', count: activeCount },
    { key: 'inactive', label: 'Inactive', count: inactiveCount },
  ];

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
            Approval flows for transfers, leaves, disbursements and other
            district actions · {definitions.length.toLocaleString()} definition
            {definitions.length === 1 ? '' : 's'}
            {pendingInstances > 0
              ? `, ${pendingInstances.toLocaleString()} running instances`
              : ''}
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
              {approvals.length > 0 ? (
                <span className="ms-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-bold text-primary">
                  {approvals.length}
                </span>
              ) : null}
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

      <div
        className="flex flex-wrap gap-1 border-b border-border"
        role="tablist"
        aria-label="Definition status"
      >
        {tabs.map((tab) => {
          const active = tab.key === filter;
          const href =
            tab.key === 'all'
              ? '/workflows'
              : `/workflows?status=${tab.key}`;
          return (
            <Link
              key={tab.key}
              href={href}
              role="tab"
              aria-selected={active}
              className={cn(
                'inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold transition-colors',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-bold tabular-nums">
                {tab.count.toLocaleString()}
              </span>
            </Link>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <EmptyState hasAny={definitions.length > 0} />
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <DefinitionsTable items={filtered} />
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function EmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <GitBranch className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="text-base font-medium">
          {hasAny ? 'No definitions match this filter' : 'No workflows defined'}
        </p>
        <p className="text-sm text-muted-foreground">
          {hasAny
            ? 'Try another status tab or reset filters.'
            : 'Define an approval flow to start routing requests.'}
        </p>
        {!hasAny ? (
          <Button asChild className="mt-2" size="sm">
            <Link href="/workflows/definitions/new">Create definition</Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DefinitionsTable({ items }: { items: WorkflowDefinition[] }) {
  return (
    <Table aria-label="Workflow definitions">
      <TableHeader>
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableHead className="font-semibold">Workflow</TableHead>
          <TableHead className="font-semibold">Module</TableHead>
          <TableHead className="text-end font-semibold">Steps</TableHead>
          <TableHead className="text-end font-semibold">Avg completion</TableHead>
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
              <p className="text-[11px] text-muted-foreground">
                v{def.version}
                {def.updatedAt ? ` · updated ${def.updatedAt}` : ''}
              </p>
            </TableCell>
            <TableCell>
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
                {def.module}
              </span>
            </TableCell>
            <TableCell className="text-end tabular-nums">
              {def.steps.length}
            </TableCell>
            <TableCell className="text-end text-xs text-muted-foreground">
              —
            </TableCell>
            <TableCell>
              <StatusPill active={def.active} />
            </TableCell>
            <TableCell className="text-muted-foreground">
              {def.updatedAt || '—'}
            </TableCell>
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
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  aria-label={`Edit ${def.name}`}
                >
                  <Link href="/workflows/definitions/new">
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  type="button"
                  disabled
                  aria-label="More actions"
                >
                  <MoreVertical className="h-4 w-4" aria-hidden="true" />
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
