/**
 * Workflow definition detail page.
 *
 * Validates: Requirement 13.1 — view workflow definition steps.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Pencil } from 'lucide-react';

import { Button, Card, CardContent } from '@proctira/ui/components';
import { getWorkflowDefinition, type WorkflowDefinition } from '@/lib/api/workflows';
import { cn } from '@/lib/utils';

interface PageProps {
  params: { id: string };
}

export default async function WorkflowDefinitionPage({ params }: PageProps) {
  const definition = await getWorkflowDefinition(params.id);
  if (!definition) notFound();

  const steps = [...definition.steps].sort((a, b) => a.order - b.order);

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
            {steps.length}-step approval chain · v{definition.version}
            {definition.updatedAt ? ` · updated ${definition.updatedAt}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/workflows/definitions/new">
              <Pencil className="me-1.5 h-4 w-4" aria-hidden="true" />
              New definition
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardContent className="p-5">
              <div className="mb-1">
                <h2 className="text-base font-semibold text-foreground">Approval pipeline</h2>
                <p className="text-sm text-muted-foreground">
                  Requests move top to bottom — each step must approve before the next is activated.
                </p>
              </div>
              {steps.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No steps defined.</p>
              ) : (
                <ol className="mt-4 space-y-0">
                  {steps.map((step, idx) => (
                    <li key={step.id} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                          {step.order}
                        </span>
                        {idx < steps.length - 1 ? (
                          <span className="h-full min-h-8 w-px bg-border" />
                        ) : null}
                      </div>
                      <div
                        className={cn(
                          'min-w-0 flex-1 rounded-lg border border-border bg-muted/30 p-4',
                          idx < steps.length - 1 && 'mb-3',
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-foreground">{step.name}</span>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Approver role:{' '}
                          <span className="font-medium text-foreground">{step.approverRole}</span>
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
                <FactRow label="Status" value={definition.active ? 'Active' : 'Inactive'} />
                <FactRow label="Steps" value={String(steps.length)} />
                <FactRow label="Updated" value={definition.updatedAt || '—'} />
              </dl>
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
