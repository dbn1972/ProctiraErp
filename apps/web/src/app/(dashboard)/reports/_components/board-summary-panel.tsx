'use client';

/**
 * G-809 — thin board rollup picker on /reports.
 */
import { useState } from 'react';

import { Button, Input } from '@proctira/ui/components';

interface BoardSummaryResponse {
  boardId: string;
  generatedAt: string;
  schools: number;
  enrolment: number;
  attendancePercent: number | null;
  feesCollectedCents: number;
  lmsCompletionPercent: number | null;
  schoolsBreakdown: Array<{ institutionId: string; name: string; enrolment: number }>;
}

export function BoardSummaryPanel() {
  const [boardId, setBoardId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<BoardSummaryResponse | null>(null);

  async function onFetch() {
    const id = boardId.trim();
    if (!id) {
      setError('Enter a board id');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/reports/board/${encodeURIComponent(id)}/summary`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        setError(`Request failed (${res.status})`);
        setSummary(null);
        return;
      }
      setSummary((await res.json()) as BoardSummaryResponse);
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
        <h2
          id="board-summary-heading"
          className="text-lg font-bold tracking-tight text-foreground"
        >
          Board summary
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Roll up schools, enrolment, attendance, fees, and LMS completion for a board.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Board id</span>
          <Input
            value={boardId}
            onChange={(e) => setBoardId(e.target.value)}
            placeholder="e.g. board UUID"
            aria-label="Board id"
          />
        </label>
        <Button type="button" size="sm" onClick={() => void onFetch()} disabled={loading}>
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
