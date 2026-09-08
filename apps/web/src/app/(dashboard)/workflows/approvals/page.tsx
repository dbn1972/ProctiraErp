/**
 * Pending approvals — workflow steps awaiting the current user's action.
 *
 * Validates: Requirement 13.1 — surface approval queue per user.
 */
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, ListChecks } from 'lucide-react';

import { Button, Card, CardContent } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listPendingApprovals, type WorkflowApproval } from '@/lib/api/workflows';
import { ApprovalDecisionButtons } from '../_components/approval-decision-buttons';

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  const session = await requireSession('/workflows/approvals');
  const approvals = await listPendingApprovals();

  return (
    <section aria-labelledby="approvals-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/workflows">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Workflows
        </Link>
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="approvals-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            My approvals
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Requests waiting on {session.user.email} for review ·{' '}
            {approvals.length.toLocaleString()} pending
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/workflows/instances">
              <ListChecks className="me-1.5 h-4 w-4" aria-hidden="true" />
              All instances
            </Link>
          </Button>
        </div>
      </div>

      {approvals.length === 0 ? (
        <Card className="overflow-hidden">
          <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <CheckCircle2
              className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
              aria-hidden="true"
            />
            You&apos;re all caught up. No approvals pending.
          </CardContent>
        </Card>
      ) : (
        <div className="flex max-w-[880px] flex-col gap-4">
          {approvals.map((a) => (
            <ApprovalCard key={a.id} approval={a} />
          ))}
        </div>
      )}
    </section>
  );
}

function ApprovalCard({ approval: a }: { approval: WorkflowApproval }) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-foreground">{a.definitionName}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Requested by {a.requestedBy || '—'} · {a.requestedAt || '—'}
            </p>
          </div>
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
            Pending
          </span>
        </div>

        <dl className="grid gap-x-4 gap-y-2 rounded-lg border border-border bg-muted/30 p-4 text-sm sm:grid-cols-[150px_1fr]">
          <dt className="text-muted-foreground">Subject</dt>
          <dd>
            <span className="text-muted-foreground">{a.subjectType}/</span>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{a.subjectId}</code>
          </dd>
          <dt className="text-muted-foreground">Step</dt>
          <dd className="font-medium text-foreground">{a.stepName || '—'}</dd>
        </dl>

        <ApprovalDecisionButtons approvalId={a.id} />
      </CardContent>
    </Card>
  );
}
