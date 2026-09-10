/**
 * Workflow instances list (Server Component).
 *
 * Validates: Requirement 13.1 — view all in-flight workflow instances.
 */
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Clock, ShieldCheck, Workflow } from 'lucide-react';

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
import { listWorkflowInstances, type WorkflowInstance } from '@/lib/api/workflows';

export const dynamic = 'force-dynamic';

export default async function WorkflowInstancesPage() {
  const instances = await listWorkflowInstances();
  const pending = instances.filter((i) => i.status === 'PENDING').length;
  const approved = instances.filter((i) => i.status === 'APPROVED').length;

  return (
    <section aria-labelledby="instances-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/workflows">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Workflows
        </Link>
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="instances-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Workflow instances
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every approval request currently moving through a workflow, district-wide ·{' '}
            {instances.length.toLocaleString()} run
            {instances.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/workflows/approvals">
              <ShieldCheck className="me-1.5 h-4 w-4" aria-hidden="true" />
              My approvals
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Workflow className="h-5 w-5" aria-hidden="true" />}
          label="Total runs"
          value={instances.length.toLocaleString()}
        />
        <KpiCard
          icon={<Clock className="h-5 w-5" aria-hidden="true" />}
          label="Pending"
          value={pending.toLocaleString()}
        />
        <KpiCard
          icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
          label="Approved"
          value={approved.toLocaleString()}
        />
        <KpiCard
          icon={<Clock className="h-5 w-5" aria-hidden="true" />}
          label="Avg completion"
          value="Currently unavailable"
          muted
        />
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {instances.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No workflow instances active.
            </p>
          ) : (
            <Table aria-label="Workflow instances">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="font-semibold">Workflow</TableHead>
                  <TableHead className="font-semibold">Subject</TableHead>
                  <TableHead className="font-semibold">Initiated by</TableHead>
                  <TableHead className="font-semibold">Started</TableHead>
                  <TableHead className="font-semibold">Current step</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {instances.map((inst) => (
                  <TableRow key={inst.id} className="group">
                    <TableCell className="font-semibold text-foreground">
                      {inst.definitionName}
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground">{inst.subjectType}/</span>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {inst.subjectId}
                      </code>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {inst.initiatedBy || '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {inst.initiatedAt || '—'}
                    </TableCell>
                    <TableCell>{inst.currentStep || '—'}</TableCell>
                    <TableCell>
                      <InstanceStatus status={inst.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function KpiCard({
  icon,
  label,
  value,
  muted = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{label}</p>
        <p
          className={
            muted
              ? 'mt-1 text-sm text-muted-foreground'
              : 'mt-1 text-3xl font-extrabold tabular-nums text-foreground'
          }
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function InstanceStatus({ status }: { status: WorkflowInstance['status'] }) {
  const map: Record<WorkflowInstance['status'], { label: string; cls: string }> = {
    APPROVED: {
      label: 'Approved',
      cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
    },
    REJECTED: {
      label: 'Rejected',
      cls: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400',
    },
    CANCELLED: {
      label: 'Cancelled',
      cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400',
    },
    PENDING: {
      label: 'Pending',
      cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
    },
  };
  const { label, cls } = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}
    >
      {label}
    </span>
  );
}
