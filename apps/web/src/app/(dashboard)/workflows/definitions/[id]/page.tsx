/**
 * Workflow definition detail page.
 *
 * Layout per redesign/web/workflows-definition-detail.html:
 *  - Status + module chips in page head
 *  - Pause / Edit actions
 *  - Approval pipeline with numbered steps
 *  - About side panel
 *
 * Validates: Requirement 13.1 — view workflow definition steps.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Pause, Pencil } from 'lucide-react';

import { Button, Card, CardContent } from '@proctira/ui/components';
import {
  getWorkflowDefinition,
  listWorkflowInstances,
  type WorkflowDefinition,
} from '@/lib/api/workflows';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

export default async function WorkflowDefinitionPage({ params }: PageProps) {
  const [definition, instances] = await Promise.all([
    getWorkflowDefinition(params.id),
    listWorkflowInstances(),
  ]);
  if (!definition) notFound();

  const steps = [...definition.steps].sort((a, b) => a.order - b.order);
  const running = instances.filter(
    (i) => i.definitionId === definition.id && i.status === 'PENDING',
  ).length;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/workflows">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Workflows
        </Link>
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
              {definition.name}
            </h1>
            <StatusPill active={definition.active} />
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
              {definition.module}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {steps.length}-step approval chain
            {running > 0 ? ` · ${running.toLocaleString()} running instances` : ''}
            {definition.updatedAt ? ` · updated ${definition.updatedAt}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" type="button" disabled>
            <Pause className="me-1.5 h-4 w-4" aria-hidden="true" />
            Pause
          </Button>
          <Button asChild size="sm">
            <Link href="/workflows/definitions/new">
              <Pencil className="me-1.5 h-4 w-4" aria-hidden="true" />
              Edit definition
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardContent className="p-5">
              <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    Approval pipeline
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Requests move top to bottom — each step must approve before
                    the next is activated.
                  </p>
                </div>
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  v{definition.version} · current
                </span>
              </div>
              {steps.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No steps defined.
                </p>
              ) : (
                <ol className="relative mt-5 space-y-0">
                  <span
                    className="absolute start-[19px] top-5 bottom-5 w-0.5 bg-border"
                    aria-hidden="true"
                  />
                  {steps.map((step, idx) => (
                    <li key={step.id} className="relative z-[1] flex gap-4">
                      <span
                        className={cn(
                          'mt-2.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-sm font-extrabold',
                          idx === 0
                            ? 'border-primary bg-primary text-primary-foreground shadow-[0_0_0_4px] shadow-primary/15'
                            : 'border-border bg-background text-muted-foreground',
                        )}
                      >
                        {step.order}
                      </span>
                      <div
                        className={cn(
                          'min-w-0 flex-1 rounded-lg border border-border bg-muted/30 p-4',
                          idx < steps.length - 1 && 'mb-3.5',
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-foreground">
                            {step.name}
                          </span>
                          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
                            Approver
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Approver role:{' '}
                          <span className="font-medium text-foreground">
                            {step.approverRole}
                          </span>
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardContent className="p-5">
              <h2 className="mb-2 text-base font-semibold text-foreground">About</h2>
              <dl>
                <FactRow label="Module" value={definition.module} />
                <FactRow label="Version" value={`v${definition.version}`} />
                <FactRow
                  label="Status"
                  value={definition.active ? 'Active' : 'Inactive'}
                />
                <FactRow label="Steps" value={String(steps.length)} />
                <FactRow
                  label="Running"
                  value={running > 0 ? running.toLocaleString() : '—'}
                />
                <FactRow
                  label="Updated"
                  value={definition.updatedAt || '—'}
                />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <h2 className="mb-1 text-base font-semibold text-foreground">
                Related
              </h2>
              <p className="mb-3 text-sm text-muted-foreground">
                Jump to live instances or your approval queue.
              </p>
              <div className="flex flex-col gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/workflows/instances">View instances</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/workflows/approvals">My approvals</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] border-b border-border/60 py-2 text-sm last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

function StatusPill({ active }: { active: WorkflowDefinition['active'] }) {
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
