'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import {
  fetchCrossBoardTransfer,
  fetchPendingTransferApprovals,
  postTransferDecision,
} from '@/lib/api/dashboards';
import { browserGatewayFetch } from '@/lib/api/browser-gateway';
import type {
  CrossBoardTransferData,
  PendingTransferApproval,
} from '@/features/dashboards/api/types';

import { transferPartyLabel } from './transfer-labels';

type Mode = { kind: 'list' } | { kind: 'detail'; transferId: string };

export function TransferWorkflowClient({ mode }: { mode: Mode }) {
  const [pending, setPending] = useState<PendingTransferApproval[] | null>(null);
  const [detail, setDetail] = useState<CrossBoardTransferData | null>(null);
  const [rules, setRules] = useState<Array<Record<string, string>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [dialog, setDialog] = useState<'reject' | 'cancel' | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode.kind === 'list') {
        const queue = await fetchPendingTransferApprovals();
        setPending(queue.data);
        const equivalency = await browserGatewayFetch<{ data: Array<Record<string, string>> }>(
          '/transfers/equivalency',
          { sameOrigin: true },
        );
        setRules(equivalency.data ?? []);
      } else {
        setDetail(await fetchCrossBoardTransfer(mode.transferId));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer workflow unavailable');
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(
    action: 'submit' | 'review' | 'approve' | 'reject' | 'cancel' | 'complete',
    note?: string,
  ) {
    if (mode.kind !== 'detail') return;
    setBusy(true);
    setError(null);
    try {
      setDetail(await postTransferDecision(mode.transferId, action, note));
      setDialog(null);
      setComment('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decision failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div
        className="space-y-3 p-4 md:p-6"
        data-testid="transfer-workflow-loading"
        aria-busy="true"
      >
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-24 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (error && (mode.kind === 'list' ? pending == null : detail == null)) {
    return (
      <div className="p-4 md:p-6">
        <Card data-testid="transfer-workflow-error">
          <CardHeader>
            <CardTitle>Transfer workflow unavailable</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" onClick={() => void load()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (mode.kind === 'list') {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <header>
          <h1 className="text-2xl font-semibold">Pending transfer approvals</h1>
          <p className="text-sm text-muted-foreground">
            Requesting registrars submit. Receiving principals approve. Tenant admins maintain
            equivalency.
          </p>
        </header>
        {(pending?.length ?? 0) === 0 ? (
          <Card data-testid="transfer-pending-empty">
            <CardHeader>
              <CardTitle>No pending approvals</CardTitle>
              <CardDescription>
                New submissions from a requesting school will appear here with names, not ids.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <ul className="space-y-3" data-testid="transfer-pending-list">
            {pending?.map((row) => (
              <li key={row.id} className="rounded-lg border p-4">
                <Link className="font-medium underline" href={`/transfers/${row.id}`}>
                  {transferPartyLabel(row.studentId, row.studentName, 'Student')}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {transferPartyLabel(row.sourceInstitutionId, row.sourceInstitutionName, 'School')}{' '}
                  →{' '}
                  {transferPartyLabel(
                    row.destinationInstitutionId,
                    row.destinationInstitutionName,
                    'School',
                  )}{' '}
                  · {row.status}
                </p>
              </li>
            ))}
          </ul>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Grade equivalency</CardTitle>
            <CardDescription>
              CBSE 100 to ICSE 100 stays the same. A state-board 80-mark internal scales by
              target/source. Bridge rows still need an exam.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {rules.length === 0 ? <p>No equivalency rules for this tenant yet.</p> : null}
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="text-left">
                  <th>Source</th>
                  <th>Target</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id}>
                    <td>
                      {rule.sourceGradeCode} {rule.sourceSubject}
                    </td>
                    <td>
                      {rule.targetGradeCode} {rule.targetSubject}
                    </td>
                    <td>{rule.mappingStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <EquivalencyForm onSaved={() => void load()} />
          </CardContent>
        </Card>
      </div>
    );
  }

  const transfer = detail;
  if (!transfer) return null;
  const caps = transfer.capabilities;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <p>
          <Link href="/transfers" className="text-sm underline">
            Back to approvals
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">
          {transferPartyLabel(transfer.studentId, transfer.studentName, 'Student')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {transfer.workflowStatus} · {transfer.source.board} → {transfer.destination.board}
        </p>
      </header>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ol className="flex flex-col gap-2 sm:flex-row sm:flex-wrap" aria-label="Transfer state">
        {transfer.states.map((state) => (
          <li
            key={state.id}
            className="rounded border px-3 py-2 text-sm"
            aria-current={state.id === transfer.currentStateId ? 'step' : undefined}
          >
            {state.label}
            {transfer.completedStateIds.includes(state.id) ? ' (done)' : ''}
            {state.id === transfer.currentStateId ? ' (current)' : ''}
          </li>
        ))}
      </ol>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>From</CardTitle>
            <CardDescription>{transfer.source.board}</CardDescription>
          </CardHeader>
          <CardContent>{transfer.source.name}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>To</CardTitle>
            <CardDescription>{transfer.destination.board}</CardDescription>
          </CardHeader>
          <CardContent>{transfer.destination.name}</CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {(transfer.timeline?.length ?? 0) === 0 ? <p>No decisions recorded yet.</p> : null}
          <ol className="space-y-2">
            {transfer.timeline?.map((event) => (
              <li key={event.id}>
                <span className="font-medium">{event.actorName}</span> {event.decision} →{' '}
                {event.toStatus}
                {event.comment ? ` — ${event.comment}` : ''}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Grade equivalency</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {transfer.equivalency.length === 0 ? (
            <p>No grade equivalency rules for this board pair.</p>
          ) : null}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th>Source subject</th>
                <th>Destination subject</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {transfer.equivalency.map((row) => (
                <tr key={row.id}>
                  <td>{row.sourceSubject}</td>
                  <td>{row.destinationSubject}</td>
                  <td>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {caps?.canSubmit ? (
          <Button type="button" disabled={busy} onClick={() => void act('submit')}>
            Submit
          </Button>
        ) : null}
        {caps?.canStartReview ? (
          <Button type="button" disabled={busy} onClick={() => void act('review')}>
            Start review
          </Button>
        ) : null}
        {caps?.canApprove ? (
          <Button type="button" disabled={busy} onClick={() => void act('approve')}>
            Approve
          </Button>
        ) : null}
        {caps?.canComplete ? (
          <Button type="button" disabled={busy} onClick={() => void act('complete')}>
            Complete enrollment move
          </Button>
        ) : null}
        {caps?.canReject ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setDialog('reject')}
          >
            Reject
          </Button>
        ) : null}
        {caps?.canCancel ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setDialog('cancel')}
          >
            Cancel transfer
          </Button>
        ) : null}
      </div>
      <ConfirmActionDialog
        open={dialog === 'reject'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title="Reject this transfer?"
        description="The requesting school will see this comment. The student stays enrolled at the source school."
        confirmLabel="Reject transfer"
        destructive
        pending={busy}
        onConfirm={() => void act('reject', comment)}
        testId="transfer-reject"
      >
        <label className="block text-sm" htmlFor="transfer-reject-comment">
          Comment
          <textarea
            id="transfer-reject-comment"
            className="mt-1 w-full rounded-md border p-2"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            required
          />
        </label>
      </ConfirmActionDialog>
      <ConfirmActionDialog
        open={dialog === 'cancel'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title="Cancel this transfer?"
        description="Cancellation is recorded on the timeline and does not move the enrollment."
        confirmLabel="Cancel transfer"
        destructive
        pending={busy}
        onConfirm={() => void act('cancel', comment)}
        testId="transfer-cancel"
      >
        <label className="block text-sm" htmlFor="transfer-cancel-comment">
          Comment
          <textarea
            id="transfer-cancel-comment"
            className="mt-1 w-full rounded-md border p-2"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
        </label>
      </ConfirmActionDialog>
    </div>
  );
}

function EquivalencyForm({ onSaved }: { onSaved: () => void }) {
  const [message, setMessage] = useState<string | null>(null);

  return (
    <form
      className="mt-4 grid gap-2 md:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void browserGatewayFetch('/transfers/equivalency', {
          method: 'POST',
          sameOrigin: true,
          json: {
            sourceBoardId: String(form.get('sourceBoardId') ?? ''),
            targetBoardId: String(form.get('targetBoardId') ?? ''),
            sourceGradeCode: String(form.get('sourceGradeCode') ?? ''),
            targetGradeCode: String(form.get('targetGradeCode') ?? ''),
            sourceSubject: String(form.get('sourceSubject') ?? ''),
            targetSubject: String(form.get('targetSubject') ?? ''),
            sourceMarksMax: Number(form.get('sourceMarksMax') ?? 100),
            targetMarksMax: Number(form.get('targetMarksMax') ?? 100),
            creditFactor: Number(form.get('creditFactor') ?? 1),
            mappingStatus: String(form.get('mappingStatus') ?? 'mapped'),
          },
        })
          .then(() => {
            setMessage('Equivalency saved.');
            onSaved();
          })
          .catch((err: unknown) => {
            setMessage(err instanceof Error ? err.message : 'Could not save equivalency');
          });
      }}
    >
      <h2 className="md:col-span-2 text-sm font-medium">Add a rule (tenant admin)</h2>
      {(
        [
          ['sourceBoardId', 'Source board id'],
          ['targetBoardId', 'Target board id'],
          ['sourceGradeCode', 'Source grade'],
          ['targetGradeCode', 'Target grade'],
          ['sourceSubject', 'Source subject'],
          ['targetSubject', 'Target subject'],
        ] as const
      ).map(([name, label]) => (
        <label key={name} className="text-sm">
          {label}
          <input name={name} required className="mt-1 w-full rounded border p-2" />
        </label>
      ))}
      <label className="text-sm">
        Source marks max
        <input
          name="sourceMarksMax"
          type="number"
          defaultValue={100}
          className="mt-1 w-full rounded border p-2"
        />
      </label>
      <label className="text-sm">
        Target marks max
        <input
          name="targetMarksMax"
          type="number"
          defaultValue={100}
          className="mt-1 w-full rounded border p-2"
        />
      </label>
      <label className="text-sm">
        Credit factor
        <input
          name="creditFactor"
          type="number"
          step="0.01"
          defaultValue={1}
          className="mt-1 w-full rounded border p-2"
        />
      </label>
      <label className="text-sm">
        Status
        <select name="mappingStatus" className="mt-1 w-full rounded border p-2">
          <option value="mapped">Mapped</option>
          <option value="bridge">Bridge exam</option>
          <option value="na">Not applicable</option>
        </select>
      </label>
      <div className="md:col-span-2">
        <Button type="submit">Save equivalency</Button>
        {message ? <p className="mt-2 text-sm">{message}</p> : null}
      </div>
    </form>
  );
}
