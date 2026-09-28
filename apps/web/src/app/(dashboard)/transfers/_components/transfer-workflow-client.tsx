'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import { EntitySearchSelect } from '@/components/shared/entity-search-select';
import {
  fetchCrossBoardTransfer,
  fetchPendingTransferApprovals,
  postTransferCreate,
  postTransferDecision,
} from '@/lib/api/dashboards';
import { browserGatewayFetch } from '@/lib/api/browser-gateway';
import type {
  CrossBoardTransferData,
  PendingTransferApproval,
} from '@/features/dashboards/api/types';

import { transferPartyLabel } from './transfer-labels';

type Mode = { kind: 'list' } | { kind: 'detail'; transferId: string };

interface EnrollmentOption {
  id: string;
  label: string;
  admissionNumber: string | null;
  enrollmentId: string;
  institutionId: string;
  institutionName: string;
  gradeId: string;
  gradeName: string;
}

interface NamedOption {
  id: string;
  name: string;
}

interface FormOptions {
  students: EnrollmentOption[];
  institutions: Array<NamedOption & { boardId: string | null; boardName: string | null }>;
  grades: Array<NamedOption & { code: string }>;
  classes: Array<NamedOption & { institutionId: string; gradeId: string }>;
  periods: NamedOption[];
  boards: Array<NamedOption & { code: string }>;
  subjects: Array<NamedOption & { code: string }>;
}

interface EquivalencyRule {
  id: string;
  sourceBoardId: string;
  sourceBoardName?: string | null;
  sourceBoardCode?: string | null;
  targetBoardId: string;
  targetBoardName?: string | null;
  targetBoardCode?: string | null;
  sourceGradeCode: string;
  targetGradeCode: string;
  sourceSubject: string;
  targetSubject: string;
  sourceMarksMax: number;
  targetMarksMax: number;
  creditFactor: number;
  mappingStatus: string;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

const DECISION_VERB: Record<string, string> = {
  SUBMIT: 'submitted',
  START_REVIEW: 'started review',
  APPROVE: 'approved',
  REJECT: 'rejected',
  CANCEL: 'cancelled',
  COMPLETE: 'completed the enrollment move',
};

const OPEN_STATUSES = new Set(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED']);

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'REJECTED' || status === 'CANCELLED'
      ? 'bg-destructive/10 text-destructive'
      : status === 'APPROVED' || status === 'COMPLETED'
        ? 'bg-primary/10 text-primary'
        : 'bg-muted text-foreground';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}
      data-testid="transfer-status-pill"
    >
      {statusLabel(status)}
    </span>
  );
}

export function TransferWorkflowClient({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingTransferApproval[] | null>(null);
  const [detail, setDetail] = useState<CrossBoardTransferData | null>(null);
  const [rules, setRules] = useState<EquivalencyRule[]>([]);
  const [options, setOptions] = useState<FormOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [dialog, setDialog] = useState<'reject' | 'cancel' | null>(null);
  const [listRejectId, setListRejectId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState('OPEN');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode.kind === 'list') {
        const [queue, equivalency, directory] = await Promise.all([
          fetchPendingTransferApprovals(),
          browserGatewayFetch<{ data: EquivalencyRule[] }>('/transfers/equivalency', {
            sameOrigin: true,
          }),
          browserGatewayFetch<FormOptions>('/transfers/options', { sameOrigin: true }),
        ]);
        setPending(queue.data);
        setRules(equivalency.data ?? []);
        setOptions(directory);
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
    transferId?: string,
  ) {
    const id = transferId ?? (mode.kind === 'detail' ? mode.transferId : null);
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const next = await postTransferDecision(id, action, note);
      if (mode.kind === 'detail' && id === mode.transferId) setDetail(next);
      else await load();
      setDialog(null);
      setListRejectId(null);
      setComment('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decision failed');
    } finally {
      setBusy(false);
    }
  }

  const visiblePending = useMemo(() => {
    const rows = pending ?? [];
    if (statusFilter === 'OPEN') return rows.filter((row) => OPEN_STATUSES.has(row.status));
    if (statusFilter === 'ALL') return rows;
    return rows.filter((row) => row.status === statusFilter);
  }, [pending, statusFilter]);

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
        <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Pending transfer approvals</h1>
            <p className="text-sm text-muted-foreground">
              Requesting registrars submit. Receiving principals approve or reject. Tenant admins
              maintain grade equivalency.
            </p>
          </div>
          <label className="text-sm" htmlFor="transfer-status-filter">
            Status
            <select
              id="transfer-status-filter"
              className="mt-1 block w-full rounded border p-2 md:w-48"
              data-testid="transfer-status-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="OPEN">Open</option>
              <option value="ALL">All</option>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </header>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {visiblePending.length === 0 ? (
          <Card data-testid="transfer-pending-empty">
            <CardHeader>
              <CardTitle>No transfers in this view</CardTitle>
              <CardDescription>
                When a requesting school submits a student, the receiving principal sees the name,
                grade, and schools here. Change the status filter if you are looking for a completed
                or rejected move.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <TransferQueue
            rows={visiblePending}
            busy={busy}
            onReject={(id) => {
              setComment('');
              setListRejectId(id);
            }}
            onApprove={(id) => void act('approve', undefined, id)}
          />
        )}
        <RequestTransferForm
          options={options}
          onCreated={(transferId) => router.push(`/transfers/${transferId}`)}
        />
        <EquivalencyEditor rules={rules} options={options} onChanged={() => void load()} />
        <ConfirmActionDialog
          open={listRejectId != null}
          onOpenChange={(open) => {
            if (!open) setListRejectId(null);
          }}
          title="Reject this transfer?"
          description="The requesting school will see this reason. The student stays enrolled at the source school."
          confirmLabel="Reject transfer"
          destructive
          pending={busy}
          onConfirm={() => void act('reject', comment, listRejectId ?? undefined)}
          testId="transfer-reject"
        >
          <label className="block text-sm" htmlFor="transfer-list-reject-comment">
            Reason
            <textarea
              id="transfer-list-reject-comment"
              className="mt-1 w-full rounded-md border p-2"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              required
            />
          </label>
        </ConfirmActionDialog>
      </div>
    );
  }

  const transfer = detail;
  if (!transfer) return null;
  const caps = transfer.capabilities;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="space-y-3">
        <p>
          <Link href="/transfers" className="text-sm underline">
            Back to approvals
          </Link>
        </p>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">
              {transferPartyLabel(transfer.studentId, transfer.studentName, 'Student')}
            </h1>
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <StatusPill status={transfer.workflowStatus ?? 'DRAFT'} />
              <span>
                {transfer.source.board} → {transfer.destination.board}
              </span>
            </p>
          </div>
          <div
            className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"
            data-testid="transfer-header-actions"
          >
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
        </div>
      </header>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <TransferStepper
        states={transfer.states}
        currentStateId={transfer.currentStateId}
        completedStateIds={transfer.completedStateIds}
      />
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
          <ol className="space-y-3">
            {transfer.timeline?.map((event) => (
              <li key={event.id} className="flex gap-3 text-sm">
                <span aria-hidden="true" className="mt-0.5 text-muted-foreground">
                  {event.decision === 'REJECT' || event.decision === 'CANCEL' ? '✕' : '●'}
                </span>
                <span>
                  <span className="font-medium">{event.actorName}</span>{' '}
                  {DECISION_VERB[event.decision] ?? event.decision.toLowerCase()}
                  {' · '}
                  <time dateTime={event.at}>{formatWhen(event.at)}</time>
                  {event.comment ? ` — “${event.comment}”` : ''}
                </span>
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
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start">
                  <th className="py-2 text-start">Source subject</th>
                  <th className="py-2 text-start">Destination subject</th>
                  <th className="py-2 text-start">Status</th>
                </tr>
              </thead>
              <tbody>
                {transfer.equivalency.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="py-2">{row.sourceSubject}</td>
                    <td className="py-2">{row.destinationSubject}</td>
                    <td className="py-2">{statusLabel(row.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      <ConfirmActionDialog
        open={dialog === 'reject'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title="Reject this transfer?"
        description="The requesting school will see this reason. The student stays enrolled at the source school."
        confirmLabel="Reject transfer"
        destructive
        pending={busy}
        onConfirm={() => void act('reject', comment)}
        testId="transfer-reject"
      >
        <label className="block text-sm" htmlFor="transfer-reject-comment">
          Reason
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
          Reason
          <textarea
            id="transfer-cancel-comment"
            className="mt-1 w-full rounded-md border p-2"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            required
          />
        </label>
      </ConfirmActionDialog>
    </div>
  );
}

function TransferStepper({
  states,
  currentStateId,
  completedStateIds,
}: {
  states: ReadonlyArray<{ id: string; label: string }>;
  currentStateId: string;
  completedStateIds: readonly string[];
}) {
  return (
    <ol
      className="flex flex-col gap-3 sm:flex-row sm:items-center"
      aria-label="Transfer state"
      data-testid="transfer-stepper"
    >
      {states.map((state, index) => {
        const done = completedStateIds.includes(state.id);
        const current = state.id === currentStateId;
        const terminal = state.id === 'rejected' || state.id === 'cancelled';
        const circle = terminal
          ? 'border-destructive bg-destructive text-destructive-foreground'
          : done
            ? 'border-primary bg-primary text-primary-foreground'
            : current
              ? 'border-primary bg-background text-primary'
              : 'border-border bg-background text-muted-foreground';
        return (
          <li
            key={state.id}
            className="flex min-w-0 flex-1 items-center gap-2"
            aria-current={current ? 'step' : undefined}
          >
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${circle}`}
              aria-hidden="true"
            >
              {terminal ? '!' : done ? '✓' : index + 1}
            </span>
            <span className={`text-sm ${current ? 'font-semibold' : 'text-muted-foreground'}`}>
              {state.label}
              <span className="sr-only">
                {done ? ' (done)' : current ? ' (current)' : ' (upcoming)'}
              </span>
            </span>
            {index < states.length - 1 ? (
              <span className="mx-1 hidden h-px flex-1 bg-border sm:block" aria-hidden="true" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function TransferQueue({
  rows,
  busy,
  onApprove,
  onReject,
}: {
  rows: PendingTransferApproval[];
  busy: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <div data-testid="transfer-pending-list">
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[48rem] text-sm">
          <thead>
            <tr className="border-b text-start">
              <th className="py-2 text-start">Student</th>
              <th className="py-2 text-start">Move</th>
              <th className="py-2 text-start">Requested</th>
              <th className="py-2 text-start">Status</th>
              <th className="py-2 text-start">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b">
                <td className="py-3">
                  <Link className="font-medium underline" href={`/transfers/${row.id}`}>
                    {transferPartyLabel(row.studentId, row.studentName, 'Student')}
                  </Link>
                  <div className="text-muted-foreground">
                    {row.currentGrade ?? 'Grade not recorded'}
                  </div>
                </td>
                <td className="py-3">
                  {transferPartyLabel(row.sourceInstitutionId, row.sourceInstitutionName, 'School')}
                  {row.sourceBoard ? ` (${row.sourceBoard})` : ''} →{' '}
                  {transferPartyLabel(
                    row.destinationInstitutionId,
                    row.destinationInstitutionName,
                    'School',
                  )}
                  {row.destinationBoard ? ` (${row.destinationBoard})` : ''}
                </td>
                <td className="py-3">
                  <div>{row.requestedBy?.trim() || 'Registrar'}</div>
                  <time dateTime={row.requestedAt}>{formatWhen(row.requestedAt)}</time>
                </td>
                <td className="py-3">
                  <StatusPill status={row.status} />
                </td>
                <td className="py-3">
                  <QueueActions row={row} busy={busy} onApprove={onApprove} onReject={onReject} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="rounded-lg border p-4">
            <Link className="font-medium underline" href={`/transfers/${row.id}`}>
              {transferPartyLabel(row.studentId, row.studentName, 'Student')}
            </Link>
            <p className="text-sm text-muted-foreground">
              {row.currentGrade ?? 'Grade not recorded'} · {row.requestedBy?.trim() || 'Registrar'}{' '}
              · <time dateTime={row.requestedAt}>{formatWhen(row.requestedAt)}</time>
            </p>
            <p className="mt-1 text-sm">
              {transferPartyLabel(row.sourceInstitutionId, row.sourceInstitutionName, 'School')} →{' '}
              {transferPartyLabel(
                row.destinationInstitutionId,
                row.destinationInstitutionName,
                'School',
              )}
            </p>
            <div className="mt-2">
              <StatusPill status={row.status} />
            </div>
            <div className="mt-3">
              <QueueActions row={row} busy={busy} onApprove={onApprove} onReject={onReject} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QueueActions({
  row,
  busy,
  onApprove,
  onReject,
}: {
  row: PendingTransferApproval;
  busy: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  if (!row.canApprove && !row.canReject) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-2">
      {row.canApprove ? (
        <Button type="button" disabled={busy} onClick={() => onApprove(row.id)}>
          Approve
        </Button>
      ) : null}
      {row.canReject ? (
        <Button type="button" variant="outline" disabled={busy} onClick={() => onReject(row.id)}>
          Reject
        </Button>
      ) : null}
    </div>
  );
}

function RequestTransferForm({
  options,
  onCreated,
}: {
  options: FormOptions | null;
  onCreated: (transferId: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [studentId, setStudentId] = useState('');
  const [enrollmentId, setEnrollmentId] = useState('');
  const [destinationInstitutionId, setDestinationInstitutionId] = useState('');
  const [destinationGradeId, setDestinationGradeId] = useState('');
  const [destinationClassId, setDestinationClassId] = useState('');
  const [academicPeriodId, setAcademicPeriodId] = useState('');

  const studentChoices = useMemo(() => {
    const seen = new Map<string, EnrollmentOption>();
    for (const row of options?.students ?? []) {
      if (!seen.has(row.id)) seen.set(row.id, row);
    }
    return [...seen.values()].map((row) => ({
      id: row.id,
      label: row.admissionNumber ? `${row.label} · ${row.admissionNumber}` : row.label,
      searchText: `${row.label} ${row.admissionNumber ?? ''}`,
    }));
  }, [options]);

  const enrollments = (options?.students ?? []).filter((row) => row.id === studentId);
  const enrollment = enrollments.find((row) => row.enrollmentId === enrollmentId) ?? enrollments[0];

  useEffect(() => {
    const matches = (options?.students ?? []).filter((row) => row.id === studentId);
    if (matches.length === 1 && matches[0]) setEnrollmentId(matches[0].enrollmentId);
  }, [options, studentId]);

  const classes = (options?.classes ?? []).filter(
    (row) =>
      row.institutionId === destinationInstitutionId &&
      (!destinationGradeId || row.gradeId === destinationGradeId),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Request a transfer</CardTitle>
        <CardDescription>
          Pick the student by name or admission number. The current school comes from the active
          enrollment. Save a draft, then submit it from the transfer page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 md:grid-cols-2"
          data-testid="transfer-request-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!enrollment) {
              setError('Choose a student who is currently enrolled.');
              return;
            }
            const form = new FormData(event.currentTarget);
            setBusy(true);
            setError(null);
            void postTransferCreate({
              studentId,
              sourceEnrollmentId: enrollment.enrollmentId,
              sourceInstitutionId: enrollment.institutionId,
              destinationInstitutionId,
              destinationGradeId,
              destinationClassId,
              academicPeriodId,
              transferDate: String(form.get('transferDate') ?? ''),
              reason: String(form.get('reason') ?? ''),
            })
              .then((created) => onCreated(created.transferId))
              .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : 'Could not save the draft');
              })
              .finally(() => setBusy(false));
          }}
        >
          <EntitySearchSelect
            id="transfer-student"
            name="studentId"
            label="Student"
            presentation="combobox"
            required
            options={studentChoices}
            placeholder="Search by name or admission number"
            emptyMessage="No enrolled students are available for this school."
            onValueChange={(id) => {
              setStudentId(id);
              setEnrollmentId('');
            }}
          />
          <div className="text-sm">
            <p className="font-medium">Current enrollment</p>
            {enrollment ? (
              <p
                className="mt-1 rounded border bg-muted/40 p-2"
                data-testid="transfer-current-enrollment"
              >
                {enrollment.institutionName} · {enrollment.gradeName}
              </p>
            ) : (
              <p className="mt-1 text-muted-foreground">
                Select a student to fill the source school.
              </p>
            )}
            {enrollments.length > 1 ? (
              <label className="mt-2 block" htmlFor="transfer-enrollment">
                Which enrollment
                <select
                  id="transfer-enrollment"
                  className="mt-1 w-full rounded border p-2"
                  value={enrollmentId}
                  onChange={(event) => setEnrollmentId(event.target.value)}
                >
                  {enrollments.map((row) => (
                    <option key={row.enrollmentId} value={row.enrollmentId}>
                      {row.institutionName} · {row.gradeName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <NamedSelect
            id="transfer-destination-school"
            label="Receiving school"
            value={destinationInstitutionId}
            onChange={setDestinationInstitutionId}
            options={(options?.institutions ?? [])
              .filter((row) => row.id !== enrollment?.institutionId)
              .map((row) => ({
                id: row.id,
                label: row.boardName ? `${row.name} (${row.boardName})` : row.name,
              }))}
          />
          <NamedSelect
            id="transfer-destination-grade"
            label="Destination grade"
            value={destinationGradeId}
            onChange={setDestinationGradeId}
            options={(options?.grades ?? []).map((row) => ({ id: row.id, label: row.name }))}
          />
          <NamedSelect
            id="transfer-destination-class"
            label="Destination class"
            value={destinationClassId}
            onChange={setDestinationClassId}
            options={classes.map((row) => ({ id: row.id, label: row.name }))}
          />
          <NamedSelect
            id="transfer-period"
            label="Academic period"
            value={academicPeriodId}
            onChange={setAcademicPeriodId}
            options={(options?.periods ?? []).map((row) => ({ id: row.id, label: row.name }))}
          />
          <label className="text-sm" htmlFor="transfer-date">
            Transfer date
            <input
              id="transfer-date"
              name="transferDate"
              type="date"
              required
              defaultValue="2026-09-28"
              className="mt-1 w-full rounded border p-2"
            />
          </label>
          <label className="text-sm md:col-span-2" htmlFor="transfer-reason">
            Reason
            <textarea
              id="transfer-reason"
              name="reason"
              required
              className="mt-1 w-full rounded border p-2"
            />
          </label>
          <div className="md:col-span-2">
            <Button type="submit" disabled={busy}>
              Save draft
            </Button>
            {error ? (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function NamedSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ id: string; label: string }>;
}) {
  return (
    <label className="text-sm" htmlFor={id}>
      {label}
      <select
        id={id}
        required
        className="mt-1 w-full rounded border p-2"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select {label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function EquivalencyEditor({
  rules,
  options,
  onChanged,
}: {
  rules: EquivalencyRule[];
  options: FormOptions | null;
  onChanged: () => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<EquivalencyRule | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function boardLabel(name?: string | null, code?: string | null): string {
    return name?.trim() || code?.trim() || 'Board';
  }

  return (
    <Card data-testid="transfer-equivalency-editor">
      <CardHeader>
        <CardTitle>Grade equivalency</CardTitle>
        <CardDescription>
          CBSE 100 to ICSE 100 stays the same. A state-board 80-mark internal scales by
          target/source. Bridge rows still need an exam. Only a tenant admin can save.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rules.length === 0 ? <p>No equivalency rules for this tenant yet.</p> : null}
        {rules.length > 0 ? (
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b text-start">
                <th className="py-2 text-start">Source</th>
                <th className="py-2 text-start">Target</th>
                <th className="py-2 text-start">Marks max</th>
                <th className="py-2 text-start">Credit factor</th>
                <th className="py-2 text-start">Status</th>
                <th className="py-2 text-start">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-b">
                  <td className="py-2">
                    {boardLabel(rule.sourceBoardName, rule.sourceBoardCode)} ·{' '}
                    {rule.sourceGradeCode} · {rule.sourceSubject}
                  </td>
                  <td className="py-2">
                    {boardLabel(rule.targetBoardName, rule.targetBoardCode)} ·{' '}
                    {rule.targetGradeCode} · {rule.targetSubject}
                  </td>
                  <td className="py-2">
                    {rule.sourceMarksMax} → {rule.targetMarksMax}
                  </td>
                  <td className="py-2">{rule.creditFactor}</td>
                  <td className="py-2">
                    <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                      {rule.mappingStatus === 'mapped'
                        ? 'Mapped'
                        : rule.mappingStatus === 'bridge'
                          ? 'Bridge'
                          : 'Not applicable'}
                    </span>
                  </td>
                  <td className="py-2">
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" onClick={() => setEditing(rule)}>
                        Edit
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setDeleteId(rule.id)}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <EquivalencyForm
          key={editing?.id ?? 'new'}
          options={options}
          editing={editing}
          onSaved={() => {
            setEditing(null);
            setMessage(editing ? 'Equivalency updated.' : 'Equivalency saved.');
            onChanged();
          }}
          onError={(text) => setMessage(text)}
        />
        {message ? <p className="mt-2 text-sm">{message}</p> : null}
        <ConfirmActionDialog
          open={deleteId != null}
          onOpenChange={(open) => {
            if (!open) setDeleteId(null);
          }}
          title="Delete this equivalency rule?"
          description="Approvals that rely on this board pair will be blocked until another mapped or bridge rule exists."
          confirmLabel="Delete rule"
          destructive
          pending={busy}
          onConfirm={() => {
            if (!deleteId) return;
            setBusy(true);
            void browserGatewayFetch(`/transfers/equivalency/${deleteId}`, {
              method: 'DELETE',
              sameOrigin: true,
            })
              .then(() => {
                setDeleteId(null);
                setMessage('Equivalency deleted.');
                onChanged();
              })
              .catch((err: unknown) => {
                setMessage(err instanceof Error ? err.message : 'Could not delete equivalency');
              })
              .finally(() => setBusy(false));
          }}
          testId="transfer-equivalency-delete"
        />
      </CardContent>
    </Card>
  );
}

function EquivalencyForm({
  options,
  editing,
  onSaved,
  onError,
}: {
  options: FormOptions | null;
  editing: EquivalencyRule | null;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  return (
    <form
      className="mt-4 grid gap-2 md:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const body = {
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
        };
        const path = editing ? `/transfers/equivalency/${editing.id}` : '/transfers/equivalency';
        void browserGatewayFetch(path, {
          method: editing ? 'PATCH' : 'POST',
          sameOrigin: true,
          json: body,
        })
          .then(() => onSaved())
          .catch((err: unknown) => {
            onError(err instanceof Error ? err.message : 'Could not save equivalency');
          });
      }}
    >
      <h2 className="text-sm font-medium md:col-span-2">
        {editing ? 'Edit rule' : 'Add a rule (tenant admin)'}
      </h2>
      <SelectField
        name="sourceBoardId"
        label="Source board"
        defaultValue={editing?.sourceBoardId}
        options={(options?.boards ?? []).map((row) => ({ id: row.id, label: row.name }))}
      />
      <SelectField
        name="targetBoardId"
        label="Target board"
        defaultValue={editing?.targetBoardId}
        options={(options?.boards ?? []).map((row) => ({ id: row.id, label: row.name }))}
      />
      <SelectField
        name="sourceGradeCode"
        label="Source grade"
        defaultValue={editing?.sourceGradeCode}
        options={(options?.grades ?? []).map((row) => ({ id: row.code, label: row.name }))}
      />
      <SelectField
        name="targetGradeCode"
        label="Target grade"
        defaultValue={editing?.targetGradeCode}
        options={(options?.grades ?? []).map((row) => ({ id: row.code, label: row.name }))}
      />
      <SelectField
        name="sourceSubject"
        label="Source subject"
        defaultValue={editing?.sourceSubject}
        options={(options?.subjects ?? []).map((row) => ({ id: row.name, label: row.name }))}
      />
      <SelectField
        name="targetSubject"
        label="Target subject"
        defaultValue={editing?.targetSubject}
        options={(options?.subjects ?? []).map((row) => ({ id: row.name, label: row.name }))}
      />
      <label className="text-sm" htmlFor="source-marks-max">
        Source marks max
        <input
          id="source-marks-max"
          name="sourceMarksMax"
          type="number"
          defaultValue={editing?.sourceMarksMax ?? 100}
          className="mt-1 w-full rounded border p-2"
        />
      </label>
      <label className="text-sm" htmlFor="target-marks-max">
        Target marks max
        <input
          id="target-marks-max"
          name="targetMarksMax"
          type="number"
          defaultValue={editing?.targetMarksMax ?? 100}
          className="mt-1 w-full rounded border p-2"
        />
      </label>
      <label className="text-sm" htmlFor="credit-factor">
        Credit factor
        <input
          id="credit-factor"
          name="creditFactor"
          type="number"
          step="0.01"
          defaultValue={editing?.creditFactor ?? 1}
          className="mt-1 w-full rounded border p-2"
        />
      </label>
      <label className="text-sm" htmlFor="mapping-status">
        Status
        <select
          id="mapping-status"
          name="mappingStatus"
          defaultValue={editing?.mappingStatus ?? 'mapped'}
          className="mt-1 w-full rounded border p-2"
        >
          <option value="mapped">Mapped</option>
          <option value="bridge">Bridge exam</option>
          <option value="na">Not applicable</option>
        </select>
      </label>
      <div className="md:col-span-2">
        <Button type="submit">{editing ? 'Update equivalency' : 'Save equivalency'}</Button>
      </div>
    </form>
  );
}

function SelectField({
  name,
  label,
  options,
  defaultValue,
}: {
  name: string;
  label: string;
  options: Array<{ id: string; label: string }>;
  defaultValue?: string;
}) {
  const id = `equivalency-${name}`;
  return (
    <label className="text-sm" htmlFor={id}>
      {label}
      <select
        id={id}
        name={name}
        required
        defaultValue={defaultValue ?? ''}
        className="mt-1 w-full rounded border p-2"
      >
        <option value="">Select {label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
