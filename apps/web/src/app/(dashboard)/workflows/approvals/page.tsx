/**
 * Pending approvals — workflow steps awaiting the current user's action.
 *
 * Layout per redesign/web/workflows-approvals.html:
 *  - Page head with All instances CTA
 *  - Pending / history tabs
 *  - Approval cards with subject details and Approve / Reject
 *
 * Validates: Requirement 13.1 — surface approval queue per user.
 * ProctiraERP — wires POST /workflows/instances/:id/transition.
 */
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, ListChecks } from 'lucide-react';

import { Button, Card, CardContent } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import {
  listApprovalHistory,
  listPendingApprovals,
  type WorkflowApproval,
  type WorkflowApprovalHistoryItem,
} from '@/lib/api/workflows';
import { cn } from '@/lib/utils';

import { ApprovalActions } from './_components/approval-actions';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function ApprovalsPage({ searchParams }: PageProps) {
  const session = await requireSession('/workflows/approvals');
  const tab = single(searchParams?.tab) === 'history' ? 'history' : 'pending';

  const [approvals, history] = await Promise.all([
    listPendingApprovals(),
    tab === 'history' ? listApprovalHistory() : Promise.resolve([]),
  ]);

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

      <div
        className="flex flex-wrap gap-1 border-b border-border"
        role="tablist"
        aria-label="Approval status"
      >
        <Link
          href="/workflows/approvals"
          role="tab"
          aria-selected={tab === 'pending'}
          className={cn(
            'inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold transition-colors',
            tab === 'pending'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          Pending
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-bold tabular-nums">
            {approvals.length.toLocaleString()}
          </span>
        </Link>
        <Link
          href="/workflows/approvals?tab=history"
          role="tab"
          aria-selected={tab === 'history'}
          className={cn(
            'inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold transition-colors',
            tab === 'history'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          History
        </Link>
      </div>

      {tab === 'history' ? (
        history.length === 0 ? (
          <Card className="overflow-hidden">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No completed decisions yet.
            </CardContent>
          </Card>
        ) : (
          <div className="flex max-w-[880px] flex-col gap-4">
            {history.map((item) => (
              <HistoryCard key={item.id} item={item} />
            ))}
          </div>
        )
      ) : approvals.length === 0 ? (
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
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
              {a.subjectType || 'Request'}
            </span>
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
              Pending
            </span>
          </div>
        </div>

        <dl className="grid gap-x-4 gap-y-2 rounded-lg border border-border bg-muted/30 p-4 text-sm sm:grid-cols-[150px_1fr]">
          <dt className="text-muted-foreground">Subject</dt>
          <dd>
            <span className="text-muted-foreground">{a.subjectType}/</span>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              {a.subjectId}
            </code>
          </dd>
          <dt className="text-muted-foreground">Step</dt>
          <dd className="font-medium text-foreground">{a.stepName || '—'}</dd>
          <dt className="text-muted-foreground">Instance</dt>
          <dd>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              {a.instanceId}
            </code>
          </dd>
        </dl>

        <ApprovalActions instanceId={a.instanceId} />
      </CardContent>
    </Card>
  );
}

function HistoryCard({ item }: { item: WorkflowApprovalHistoryItem }) {
  const statusColour =
    item.status === 'REJECTED'
      ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400'
      : item.status === 'CANCELLED'
        ? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
        : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400';

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-foreground">{item.definitionName}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {item.decidedBy} · {item.decidedAt} · {item.action}
            </p>
          </div>
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
              statusColour,
            )}
          >
            {item.status}
          </span>
        </div>
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[120px_1fr]">
          <dt className="text-muted-foreground">Subject</dt>
          <dd>
            <span className="text-muted-foreground">{item.subjectType}/</span>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              {item.subjectId}
            </code>
          </dd>
          <dt className="text-muted-foreground">Step</dt>
          <dd className="font-medium text-foreground">{item.stepName}</dd>
        </dl>
      </CardContent>
    </Card>
  );
}
