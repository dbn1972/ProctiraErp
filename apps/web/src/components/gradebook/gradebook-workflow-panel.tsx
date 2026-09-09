'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  bulkTransitionGradeEntriesAction,
  computeClassRankAction,
  createCommentsBankAction,
  transitionGradeEntryAction,
} from '@/app/(dashboard)/gradebook-actions';
import { useHydrated } from '@/hooks/useHydrated';
import { resolveEntityLabel } from '@/lib/entity-label';
import {
  readGradeWorkflowStatus,
  type ClassRankSnapshot,
  type CommentsBankItem,
  type GradeEntry,
  type GradeWorkflowAction,
} from '@/lib/api/gradebook';
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

  const rankByStudent = useMemo(() => {
    const map = new Map<string, ClassRankSnapshot>();
    for (const row of ranks) map.set(row.studentId, row);
    return map;
  }, [ranks]);

  const runTransition = (ids: string[], action: GradeWorkflowAction) => {
    if (ids.length === 0) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result =
        ids.length === 1
          ? await transitionGradeEntryAction({ id: ids[0]!, action, institutionId })
          : await bulkTransitionGradeEntriesAction({ ids, action, institutionId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(`${action} applied to ${ids.length} ${ids.length === 1 ? 'entry' : 'entries'}.`);
      setSelected([]);
      router.refresh();
    });
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
              onClick={() => runTransition(selected, 'approve')}
            >
              Approve selected
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-testid="bulk-lock"
              disabled={pending || selected.length === 0}
              onClick={() => runTransition(selected, 'lock')}
            >
              Lock selected
            </Button>
            <Button
              type="button"
              size="sm"
              data-testid="bulk-publish"
              disabled={pending || selected.length === 0}
              onClick={() => runTransition(selected, 'publish')}
            >
              Publish selected
            </Button>
          </>
        ) : null}
      </div>
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
        <p className="text-sm text-muted-foreground" data-testid="gradebook-empty">
          No grades entered for this section.
        </p>
      ) : (
        <div className="overflow-x-auto">
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
                      {status}
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
                      {next && canRun(next, canSubmit, canModerate) ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          data-testid={`transition-${next}-${row.id}`}
                          onClick={() => runTransition([row.id], next)}
                        >
                          {next === 'submit'
                            ? 'Submit'
                            : next === 'approve'
                              ? 'Approve'
                              : next === 'lock'
                                ? 'Lock'
                                : 'Publish'}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
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
          const fd = new FormData(event.currentTarget);
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
            event.currentTarget.reset();
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
