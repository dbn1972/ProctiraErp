'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  bulkTransitionGradeEntriesAction,
  computeClassRankAction,
  createCommentsBankAction,
  transitionGradeEntryAction,
} from '@/app/(dashboard)/gradebook-actions';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import { useHydrated } from '@/hooks/useHydrated';
import { resolveEntityLabel } from '@/lib/entity-label';
import { workflowPillClass } from '@/lib/gradebook/presentation';
import {
  readGradeWorkflowStatus,
  type ClassRankSnapshot,
  type CommentsBankItem,
  type GradeEntry,
  type GradeWorkflowAction,
} from '@/lib/gradebook/workflow-status';
import { Button, Input, Label, Textarea } from '@proctira/ui/components';

const NEXT_ACTION: Record<string, GradeWorkflowAction | null> = {
  DRAFT: 'submit',
  SUBMITTED: 'approve',
  APPROVED: 'lock',
  LOCKED: 'publish',
  PUBLISHED: null,
  REJECTED: 'submit',
};

function canRun(action: GradeWorkflowAction, canSubmit: boolean, canModerate: boolean): boolean {
  if (action === 'submit') return canSubmit;
  return canModerate;
}

export function GradebookWorkflowPanel({
  institutionId,
  sectionId,
  academicPeriodId,
  boardId,
  entries,
  ranks,
  comments,
  studentLabel,
  canSubmit,
  canModerate,
}: {
  institutionId: string;
  sectionId: string;
  academicPeriodId?: string;
  boardId?: string;
  entries: GradeEntry[];
  ranks: ClassRankSnapshot[];
  comments: CommentsBankItem[];
  studentLabel: Map<string, string>;
  canSubmit: boolean;
  canModerate: boolean;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmBulk, setConfirmBulk] = useState<{
    action: GradeWorkflowAction;
    ids: string[];
  } | null>(null);
  // PRC-M474: reject needs a mandatory reason, captured in its own dialog.
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);

  const rankByStudent = useMemo(() => {
    const map = new Map<string, ClassRankSnapshot>();
    for (const row of ranks) map.set(row.studentId, row);
    return map;
  }, [ranks]);

  const runTransition = (ids: string[], action: GradeWorkflowAction, reason?: string) => {
    if (ids.length === 0) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result =
        ids.length === 1
          ? await transitionGradeEntryAction({ id: ids[0]!, action, institutionId, reason })
          : await bulkTransitionGradeEntriesAction({ ids, action, institutionId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // PRC-M474: report what the server actually transitioned, not the selection size.
      const applied =
        ids.length === 1 ? 1 : typeof result.extra?.count === 'number' ? result.extra.count : 0;
      setMessage(
        applied === ids.length
          ? `${action} applied to ${applied} ${applied === 1 ? 'entry' : 'entries'}.`
          : `${action} applied to ${applied} of ${ids.length} entries. Check the remaining entries' status.`,
      );
      setSelected([]);
      setConfirmBulk(null);
      setRejectTarget(null);
      setRejectReason('');
      router.refresh();
    });
  };
  const confirmReject = () => {
    const reason = rejectReason.trim();
    if (!rejectTarget) return;
    if (!reason) {
      setRejectError('Enter a reason so the teacher knows what to fix.');
      return;
    }
    setRejectError(null);
    runTransition([rejectTarget], 'reject', reason);
  };

  const requestTransition = (ids: string[], action: GradeWorkflowAction) => {
    if (ids.length === 0) return;
    if (action === 'publish' || action === 'lock' || action === 'approve' || action === 'reopen') {
      setConfirmBulk({ action, ids });
      return;
    }
    runTransition(ids, action);
  };

  const onComputeRank = () => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await computeClassRankAction({
        sectionId,
        institutionId,
        academicPeriodId,
        boardId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(`Class rank computed for ${String(result.extra?.count ?? 0)} students.`);
      router.refresh();
    });
  };

  const toggle = (id: string, checked: boolean) => {
    setSelected((prev) => (checked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
  };

  return (
    <div
      className="space-y-3"
      data-testid="gradebook-workflow-panel"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <p className="text-sm text-muted-foreground">
        Workflow: Draft → Submit → Approve → Lock → Publish. Parents and students only see Published
        grades.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="compute-class-rank"
          disabled={pending || entries.length === 0}
          onClick={onComputeRank}
        >
          Compute class rank / CGPA
        </Button>
        {canSubmit ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="bulk-submit"
            disabled={pending || selected.length === 0}
            onClick={() => runTransition(selected, 'submit')}
          >
            Submit selected
          </Button>
        ) : null}
        {canModerate ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-testid="bulk-approve"
              disabled={pending || selected.length === 0}
              onClick={() => requestTransition(selected, 'approve')}
            >
              Approve selected
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-testid="bulk-lock"
              disabled={pending || selected.length === 0}
              onClick={() => requestTransition(selected, 'lock')}
            >
              Lock selected
            </Button>
            <Button
              type="button"
              size="sm"
              data-testid="bulk-publish"
              disabled={pending || selected.length === 0}
              onClick={() => requestTransition(selected, 'publish')}
            >
              Publish selected
            </Button>
          </>
        ) : null}
      </div>
      <ConfirmActionDialog
        open={confirmBulk !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmBulk(null);
        }}
        title={
          confirmBulk?.action === 'publish'
            ? `Publish ${confirmBulk.ids.length} grade ${confirmBulk.ids.length === 1 ? 'entry' : 'entries'}?`
            : confirmBulk?.action === 'lock'
              ? `Lock ${confirmBulk.ids.length} grade ${confirmBulk.ids.length === 1 ? 'entry' : 'entries'}?`
              : confirmBulk?.action === 'reopen'
                ? `Unpublish ${confirmBulk.ids.length} grade ${confirmBulk.ids.length === 1 ? 'entry' : 'entries'}?`
                : `Approve ${confirmBulk?.ids.length ?? 0} grade ${(confirmBulk?.ids.length ?? 0) === 1 ? 'entry' : 'entries'}?`
        }
        description={
          confirmBulk?.action === 'publish'
            ? 'Publishing makes grades visible to parents and students. An authorised moderator can unpublish later; that change is audited.'
            : confirmBulk?.action === 'reopen'
              ? 'Unpublishing hides these grades from parents and students and returns them to draft. The change is written to the grade audit.'
              : confirmBulk?.action === 'lock'
                ? 'Locking prevents further edits until a moderator reopens the entry.'
                : 'Approving advances these entries toward lock and publish.'
        }
        confirmLabel={
          confirmBulk?.action === 'publish'
            ? 'Publish'
            : confirmBulk?.action === 'reopen'
              ? 'Unpublish'
              : confirmBulk?.action === 'lock'
                ? 'Lock'
                : 'Approve'
        }
        pending={pending}
        onConfirm={() => {
          if (confirmBulk) runTransition(confirmBulk.ids, confirmBulk.action);
        }}
        testId="gradebook-workflow-confirm"
      />
      <ConfirmActionDialog
        open={rejectTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRejectTarget(null);
            setRejectReason('');
            setRejectError(null);
          }
        }}
        title="Reject this grade entry?"
        description="The entry returns to the teacher as Rejected with your reason, and can be corrected and resubmitted."
        confirmLabel="Reject"
        destructive
        pending={pending}
        onConfirm={confirmReject}
        testId="gradebook-reject-confirm"
      >
        <div className="space-y-1.5">
          <Label htmlFor="grade-reject-reason">Reason (required)</Label>
          <Textarea
            id="grade-reject-reason"
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            maxLength={500}
            rows={3}
            required
            aria-required="true"
            aria-invalid={rejectError ? 'true' : undefined}
            aria-describedby={rejectError ? 'grade-reject-reason-error' : undefined}
            data-testid="grade-reject-reason"
          />
          {rejectError ? (
            <p id="grade-reject-reason-error" role="alert" className="text-sm text-destructive">
              {rejectError}
            </p>
          ) : null}
        </div>
      </ConfirmActionDialog>
      {message ? (
        <p className="text-sm text-foreground" data-testid="gradebook-workflow-message">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert" data-testid="gradebook-workflow-error">
          {error}
        </p>
      ) : null}
      {entries.length === 0 ? (
        <div className="py-8 text-center" data-testid="gradebook-empty">
          <p className="text-base font-semibold">No grades entered for this section</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Save the first grade above. Entries then move through Submit, Approve, Lock, and
            Publish.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto" id="gradebook-entries">
          <table
            className="w-full min-w-[52rem] text-start text-sm"
            data-testid="gradebook-entries"
          >
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-2 pe-3 font-medium">
                  <span className="sr-only">Select</span>
                </th>
                <th className="py-2 pe-3 font-medium">Student</th>
                <th className="py-2 pe-3 font-medium">Assessment</th>
                <th className="py-2 pe-3 font-medium">Score</th>
                <th className="py-2 pe-3 font-medium">Letter</th>
                <th className="py-2 pe-3 font-medium">Workflow</th>
                <th className="py-2 pe-3 font-medium">Rank</th>
                <th className="py-2 pe-3 font-medium">CGPA</th>
                <th className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((row) => {
                const status = readGradeWorkflowStatus(row);
                const next = NEXT_ACTION[status];
                const rank = rankByStudent.get(row.studentId);
                const remark = typeof row.metadata?.remark === 'string' ? row.metadata.remark : '';
                return (
                  <tr
                    key={row.id}
                    className="border-b border-border/60"
                    data-testid="grade-entry-row"
                    data-entry-id={row.id}
                    data-workflow={status}
                  >
                    <td className="py-2 pe-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${resolveEntityLabel(row.studentId, studentLabel, 'Student')}`}
                        checked={selected.includes(row.id)}
                        onChange={(event) => toggle(row.id, event.target.checked)}
                        data-testid={`select-entry-${row.id}`}
                      />
                    </td>
                    <td className="py-2 pe-3 text-sm">
                      {resolveEntityLabel(row.studentId, studentLabel, 'Student')}
                    </td>
                    <td className="py-2 pe-3">{row.assessmentCode ?? '—'}</td>
                    <td className="py-2 pe-3 tabular-nums">{row.numericScore ?? '—'}</td>
                    <td className="py-2 pe-3">{row.letterGrade ?? '—'}</td>
                    <td className="py-2 pe-3 text-xs" data-testid={`workflow-${row.id}`}>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${workflowPillClass(status)}`}
                      >
                        {status === 'PUBLISHED'
                          ? 'Published'
                          : status === 'LOCKED'
                            ? 'Locked'
                            : status === 'APPROVED'
                              ? 'Approved'
                              : status === 'SUBMITTED'
                                ? 'Submitted'
                                : status === 'REJECTED'
                                  ? 'Rejected'
                                  : 'Draft'}
                      </span>
                      {remark ? (
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          {remark}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pe-3 tabular-nums" data-testid={`rank-${row.studentId}`}>
                      {rank?.classRank ?? '—'}
                    </td>
                    <td className="py-2 pe-3 tabular-nums" data-testid={`cgpa-${row.studentId}`}>
                      {rank?.cgpa ?? '—'}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                      {next && canRun(next, canSubmit, canModerate) ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          data-testid={`transition-${next}-${row.id}`}
                          onClick={() => requestTransition([row.id], next)}
                        >
                          {next === 'submit'
                            ? 'Submit'
                            : next === 'approve'
                              ? 'Approve'
                              : next === 'lock'
                                ? 'Lock'
                                : 'Publish'}
                        </Button>
                      ) : status === 'PUBLISHED' && canModerate ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          data-testid={`transition-reopen-${row.id}`}
                          onClick={() => requestTransition([row.id], 'reopen')}
                        >
                          Unpublish
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                      {status === 'SUBMITTED' && canModerate ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          data-testid={`transition-reject-${row.id}`}
                          onClick={() => {
                            setRejectTarget(row.id);
                            setRejectReason('');
                            setRejectError(null);
                          }}
                        >
                          Reject
                        </Button>
                      ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <CommentsBankCard institutionId={institutionId} comments={comments} />
    </div>
  );
}

function CommentsBankCard({
  institutionId,
  comments,
}: {
  institutionId: string;
  comments: CommentsBankItem[];
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <h4 className="text-sm font-semibold">Comments bank</h4>
      <p className="text-xs text-muted-foreground">
        Reusable remarks by subject or grade band. Pick one when entering a grade.
      </p>
      <form
        className="grid gap-3 sm:grid-cols-2"
        data-testid="comments-bank-form"
        data-hydrated={hydrated ? 'true' : 'false'}
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const fd = new FormData(form);
          setError(null);
          startTransition(async () => {
            const result = await createCommentsBankAction({
              institutionId,
              gradeBand: String(fd.get('gradeBand') ?? '').trim(),
              label: String(fd.get('label') ?? '').trim(),
              body: String(fd.get('body') ?? '').trim(),
            });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            form.reset();
            router.refresh();
          });
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="cb-label">Label</Label>
          <Input id="cb-label" name="label" required maxLength={200} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cb-band">Grade band</Label>
          <Input id="cb-band" name="gradeBand" placeholder="A1" maxLength={20} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="cb-body">Remark</Label>
          <Textarea id="cb-body" name="body" required maxLength={4000} rows={2} />
        </div>
        <Button type="submit" size="sm" disabled={pending} data-testid="add-comment-bank">
          {pending ? 'Saving…' : 'Add comment'}
        </Button>
      </form>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No bank comments yet.</p>
      ) : (
        <ul className="space-y-1 text-sm" data-testid="comments-bank-list">
          {comments.map((item) => (
            <li key={item.id}>
              <span className="font-medium">{item.label}</span>
              {item.gradeBand ? ` · ${item.gradeBand}` : ''} — {item.body}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CommentsBankPicker({
  comments,
  value,
  onChange,
}: {
  comments: CommentsBankItem[];
  value: string;
  onChange: (body: string, commentBankId: string | null) => void;
}) {
  const hydrated = useHydrated();
  return (
    <div className="space-y-1.5" data-hydrated={hydrated ? 'true' : 'false'}>
      <Label htmlFor="commentBankPick">Comments bank</Label>
      <select
        id="commentBankPick"
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        data-testid="comments-bank-picker"
        value={value}
        onChange={(event) => {
          const id = event.target.value;
          const item = comments.find((c) => c.id === id);
          onChange(item?.body ?? '', item?.id ?? null);
        }}
      >
        <option value="">Custom remark</option>
        {comments.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
            {item.gradeBand ? ` (${item.gradeBand})` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
