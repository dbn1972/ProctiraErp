/**
 * Student profile KPI derivation (PRC-L054).
 *
 * KPIs are computed from system-of-record data only — gradebook entries and
 * fee invoices — never from free-form `student.customData`. Each helper
 * returns `null` when there is no source data so the caller can hide the card.
 */
import type { GradeEntry } from '@/lib/gradebook/workflow-status';
import type { FeeInvoice } from '@/lib/api/fees';

/** Attendance % at or above which the KPI reads "on track". */
export const ATTENDANCE_ON_TRACK_PCT = 90;

const FAILING_LETTER_GRADES = new Set(['F', 'E', 'FAIL', 'FAILED', 'U', 'NG', 'AB']);

export type GradeOutcome = 'pass' | 'fail' | 'unknown';

/**
 * Pass/fail for one grade entry. Explicit `metadata.passed` wins; otherwise a
 * failing letter grade means fail. Anything else is `unknown` (neutral badge).
 */
export function gradeOutcome(entry: Pick<GradeEntry, 'letterGrade' | 'metadata'>): GradeOutcome {
  const passed = entry.metadata?.['passed'];
  if (passed === true) return 'pass';
  if (passed === false) return 'fail';
  const letter = entry.letterGrade?.trim().toUpperCase();
  if (!letter) return 'unknown';
  if (FAILING_LETTER_GRADES.has(letter)) return 'fail';
  return 'pass';
}

export function gradeBadgeVariant(outcome: GradeOutcome): 'success' | 'destructive' | 'outline' {
  if (outcome === 'pass') return 'success';
  if (outcome === 'fail') return 'destructive';
  return 'outline';
}

/** Mean of numeric gradebook scores, or null when none are recorded. */
export function averageScore(entries: readonly Pick<GradeEntry, 'numericScore'>[]): number | null {
  const scores = entries
    .map((e) => e.numericScore)
    .filter((s): s is number => typeof s === 'number' && Number.isFinite(s));
  if (scores.length === 0) return null;
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}

/** Most recent first (by enteredAt). */
export function recentGradeEntries<T extends Pick<GradeEntry, 'enteredAt'>>(
  entries: readonly T[],
  limit?: number,
): T[] {
  const sorted = [...entries].sort((a, b) => b.enteredAt.localeCompare(a.enteredAt));
  return limit === undefined ? sorted : sorted.slice(0, limit);
}

export interface FeeStatusSummary {
  label: string;
  tone: 'clear' | 'due' | 'overdue';
}

/**
 * Fee status from the same invoice list as the Fees tab. `void` and
 * `written_off` invoices are ignored. Null when the student has no invoices.
 */
export function summarizeFeeStatus(
  invoices: readonly Pick<FeeInvoice, 'status'>[],
): FeeStatusSummary | null {
  const live = invoices.filter((i) => {
    const s = i.status.toLowerCase();
    return s !== 'void' && s !== 'written_off';
  });
  if (live.length === 0) return null;
  const overdue = live.filter((i) => i.status.toLowerCase() === 'overdue').length;
  const open = live.filter((i) => i.status.toLowerCase() === 'open').length;
  if (overdue > 0) return { label: `${overdue} overdue`, tone: 'overdue' };
  if (open > 0) return { label: `${open} unpaid`, tone: 'due' };
  return { label: 'Clear', tone: 'clear' };
}
