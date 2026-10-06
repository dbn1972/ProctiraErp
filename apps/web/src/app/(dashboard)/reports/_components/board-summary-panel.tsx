'use client';

/**
 * G-809 — thin board rollup picker on /reports.
 */
import { useState } from 'react';

import { Button } from '@proctira/ui/components';

import type { EntityLabelOption } from '@/lib/entity-label';
import { getBoardSummaryAction, type BoardSummary } from '../board-summary-actions';

export function BoardSummaryPanel({ boardOptions = [] }: { boardOptions?: EntityLabelOption[] }) {
  const [boardId, setBoardId] = useState(boardOptions[0]?.id ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<BoardSummary | null>(null);

  async function onFetch() {
    const id = boardId.trim();
    if (!id) {
      setError('Select a board');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // PRC-M110: Server Action -> gateway (no client fetch to /api/v1/*).
      const result = await getBoardSummaryAction(id);
      if (result.status === 'error') {
        setError(result.message);
        setSummary(null);
        return;
      }
      setSummary(result.summary);
    } catch {
      setError('Could not reach board summary');
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }
  return (
    <section
      aria-labelledby="board-summary-heading"
      className="space-y-3 border-t border-border pt-6"
    >
      <div>
        <h2 id="board-summary-heading" className="text-lg font-bold tracking-tight text-foreground">
          Board summary
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Roll up schools, enrolment, attendance, fees, and LMS completion for a board.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Board</span>
          {boardOptions.length === 0 ? (
            <p
              className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground"
              role="status"
            >
              No boards available from the gradebook directory yet.
            </p>
          ) : (
            <select
              value={boardId}
              onChange={(e) => setBoardId(e.target.value)}
              aria-label="Board"
              className="h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select board…</option>
              {boardOptions.map((board) => (
                <option key={board.id} value={board.id}>
                  {board.label}
                </option>
              ))}
            </select>
          )}
        </label>
        <Button
          type="button"
          className="min-h-11"
          onClick={() => void onFetch()}
          disabled={loading || boardOptions.length === 0 || !boardId}
        >
          {loading ? 'Loading…' : 'Fetch summary'}
        </Button>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {summary ? (
        <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Schools</dt>
            <dd className="font-medium tabular-nums">{summary.schools.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Enrolment</dt>
            <dd className="font-medium tabular-nums">{summary.enrolment.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Attendance</dt>
            <dd className="font-medium tabular-nums">
              {summary.attendancePercent == null ? '—' : `${summary.attendancePercent}%`}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Fees collected</dt>
            <dd className="font-medium tabular-nums">
              {(summary.feesCollectedCents / 100).toLocaleString(undefined, {
                style: 'currency',
                currency: 'INR',
                maximumFractionDigits: 0,
              })}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">LMS completion</dt>
            <dd className="font-medium tabular-nums">
              {summary.lmsCompletionPercent == null ? '—' : `${summary.lmsCompletionPercent}%`}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Generated</dt>
            <dd className="font-medium">{new Date(summary.generatedAt).toLocaleString()}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
