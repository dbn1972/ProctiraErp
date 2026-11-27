/**
 * Grades oracle (pure), from the documented rules:
 *
 * - Assessment grading schemes (assessment-service.ts createGradingScheme,
 *   PRC-H114): min < max; every band inside the range with min <= max; bands do
 *   not overlap; no gap wider than MAX_BAND_GAP (1) between neighbours; bands
 *   start at the scheme minimum and end at the scheme maximum.
 * - Subject grade (result-service.ts, PRC-H034 / PRC-H114): each entered item
 *   is normalised to 0-100 and weighted; the average is pro-rated by the entered
 *   weight and scaled to the scheme range, rounded to 2 dp; the grade is the
 *   highest band whose minimum is <= the average (half-open), Ungraded above
 *   the top or below the bottom.
 * - Gradebook (gpa-engine.ts): a numeric score maps to the configured band
 *   that contains it (inclusive); GPA = mean of band grade points of the
 *   approved (APPROVED / LOCKED / PUBLISHED) entries, credits default 1,
 *   rounded half-up to 3 dp; report cards list PUBLISHED entries only.
 * - Grade workflow (grade-workflow.ts G-303): DRAFT -> SUBMITTED -> APPROVED ->
 *   LOCKED -> PUBLISHED, SUBMITTED -> REJECTED -> SUBMITTED, reopen from
 *   APPROVED / LOCKED / PUBLISHED to DRAFT.
 */
import fc from 'fast-check';

import { COMMON_INVARIANTS, type InvariantMeta } from './core.js';

export const MAX_BAND_GAP = 1;
const EPS = 1e-9;

export interface Threshold {
  grade: string;
  minScore: number;
  maxScore: number;
}

export function schemeValid(
  minValue: number,
  maxValue: number,
  thresholds: readonly Threshold[],
): { ok: boolean; why: string } {
  if (!(minValue < maxValue)) return { ok: false, why: 'min >= max' };
  if (thresholds.length === 0) return { ok: false, why: 'no bands' };
  for (const t of thresholds) {
    if (t.minScore > t.maxScore) return { ok: false, why: `${t.grade} inverted` };
    if (t.minScore < minValue || t.maxScore > maxValue)
      return { ok: false, why: `${t.grade} outside range` };
  }
  const sorted = [...thresholds].sort((a, b) => a.minScore - b.minScore);
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.minScore <= prev.maxScore)
      return { ok: false, why: `${prev.grade}/${cur.grade} overlap` };
    if (cur.minScore - prev.maxScore > MAX_BAND_GAP + EPS) {
      return { ok: false, why: `${prev.grade}/${cur.grade} gap ${cur.minScore - prev.maxScore}` };
    }
  }
  if (Math.abs(sorted[0]!.minScore - minValue) > EPS)
    return { ok: false, why: 'does not start at min' };
  const top = Math.max(...sorted.map((t) => t.maxScore));
  if (Math.abs(top - maxValue) > EPS) return { ok: false, why: 'does not end at max' };
  return { ok: true, why: 'contiguous cover' };
}

/** Half-open band for a subject average (highest band whose minimum <= score). */
export function bandForAverage(score: number, thresholds: readonly Threshold[]): string {
  if (thresholds.length === 0) return 'Ungraded';
  const top = Math.max(...thresholds.map((t) => t.maxScore));
  if (score > top) return 'Ungraded';
  const desc = [...thresholds].sort((a, b) => b.minScore - a.minScore);
  return desc.find((t) => score >= t.minScore)?.grade ?? 'Ungraded';
}

export interface MItem {
  id: string;
  weight: number;
  minScore: number;
  maxScore: number;
}

/** Subject weighted average as documented (PRC-H034 pro-rating), 2 dp. */
export function weightedAverage(
  items: readonly MItem[],
  scores: ReadonlyMap<string, number>,
  schemeMin: number,
  schemeMax: number,
): { average: number; complete: boolean } {
  let total = 0;
  let entered = 0;
  for (const it of items) {
    const s = scores.get(it.id);
    if (s === undefined) continue;
    total += (((s - it.minScore) / (it.maxScore - it.minScore)) * 100 * it.weight) / 100;
    entered += it.weight;
  }
  let avg = 0;
  if (entered > 0) avg = schemeMin + (((total / entered) * 100) / 100) * (schemeMax - schemeMin);
  return { average: Math.round(avg * 100) / 100, complete: items.every((i) => scores.has(i.id)) };
}

export interface Band {
  label: string;
  min: number;
  max: number;
  points: number;
}

/** Configured gradebook band containing a percent (inclusive bounds). */
export function bandForPercent(score: number, bands: readonly Band[]): Band | null {
  return bands.find((b) => score >= b.min - EPS && score <= b.max + EPS) ?? null;
}

export function roundHalfUp(value: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round((value + Number.EPSILON) * f) / f;
}

export type Workflow = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'LOCKED' | 'PUBLISHED';
export type Action = 'submit' | 'approve' | 'reject' | 'lock' | 'publish' | 'reopen';

export const WORKFLOW: Record<Action, { from: Workflow[]; to: Workflow }> = {
  submit: { from: ['DRAFT', 'REJECTED'], to: 'SUBMITTED' },
  approve: { from: ['SUBMITTED'], to: 'APPROVED' },
  reject: { from: ['SUBMITTED'], to: 'REJECTED' },
  lock: { from: ['APPROVED', 'LOCKED'], to: 'LOCKED' },
  publish: { from: ['LOCKED', 'PUBLISHED'], to: 'PUBLISHED' },
  reopen: { from: ['LOCKED', 'APPROVED', 'PUBLISHED'], to: 'DRAFT' },
};

export const isApproved = (w: Workflow) => w === 'APPROVED' || w === 'LOCKED' || w === 'PUBLISHED';
export const isEditable = (w: Workflow) => w === 'DRAFT' || w === 'REJECTED';

export const GRADES_INVARIANTS: InvariantMeta[] = [
  {
    id: 'scheme-contiguous',
    title: 'A grading scheme is accepted only when its bands are contiguous and cover the range',
    module: 'assessment',
    category: 'grade',
    severity: 'high',
    source: 'PRC-H114 validateThresholds; BRIEF grades match the configured scale',
  },
  {
    id: 'subject-average',
    title: 'Subject average equals the weighted, pro-rated mean of entered marks',
    module: 'assessment',
    category: 'grade',
    severity: 'high',
    source: 'result-service.ts computeGrade (PRC-H034)',
  },
  {
    id: 'grade-matches-scale',
    title: 'The subject grade is the configured band that contains the average',
    module: 'assessment',
    category: 'grade',
    severity: 'high',
    source: 'BRIEF; PRC-H114 assignGradeForScore half-open bands',
  },
  {
    id: 'scheme-frozen-after-results',
    title: 'Bands of a scheme with recorded results cannot change; items cannot be redefined',
    module: 'assessment',
    category: 'grade',
    severity: 'high',
    source: 'PRC-H037 / PRC-H038',
  },
  {
    id: 'entry-grade-matches-scale',
    title:
      'A stored grade entry letter is a band of the configured scale and agrees with its score',
    module: 'gradebook',
    category: 'grade',
    severity: 'medium',
    source: 'BRIEF grades match the configured scale; gpa-engine resolveGradePoints',
  },
  {
    id: 'workflow-transitions',
    title: 'Grade entries move only along the moderation workflow; locked entries are not editable',
    module: 'gradebook',
    category: 'grade',
    severity: 'high',
    source: 'grade-workflow.ts TRANSITIONS (G-303); PRC-M264',
  },
  {
    id: 'gpa-matches-scale',
    title:
      'GPA snapshot equals the mean grade points of the approved entries on the configured scale',
    module: 'gradebook',
    category: 'grade',
    severity: 'high',
    source: 'gpa-engine computeGpaSnapshot; PRC-M268 approved grades only',
  },
  {
    id: 'report-card-published-only',
    title: 'A report card lists exactly the published grade entries',
    module: 'gradebook',
    category: 'grade',
    severity: 'high',
    source: 'PRC-M265 only PUBLISHED grades',
  },
  ...COMMON_INVARIANTS('grades'),
];

export type Perturb =
  'none' | 'overlap' | 'gap' | 'short-top' | 'short-bottom' | 'outside' | 'inverted';

/** Contiguous bands over [0, max] from cut fractions, then an optional defect. */
export function buildThresholds(
  max: number,
  cuts: readonly number[],
  step: 0.01 | 1,
  perturb: Perturb,
): Threshold[] {
  const points = [
    ...new Set(cuts.map((c) => Math.round(Math.round((c * max) / step) * step * 100) / 100)),
  ]
    .filter((p) => p > 0 && p < max)
    .sort((a, b) => a - b);
  const starts = [0, ...points];
  const t: Threshold[] = starts.map((start, i) => {
    const next = starts[i + 1];
    return {
      grade: String.fromCharCode(70 - Math.min(i, 5)) + (i > 5 ? String(i) : ''),
      minScore: start,
      maxScore: next === undefined ? max : Math.round((next - step) * 100) / 100,
    };
  });
  const fix = (v: number) => Math.round(v * 100) / 100;
  if (perturb === 'overlap' && t.length > 1) t[1] = { ...t[1]!, minScore: fix(t[0]!.maxScore) };
  if (perturb === 'gap' && t.length > 1) t[1] = { ...t[1]!, minScore: fix(t[0]!.maxScore + 2.5) };
  if (perturb === 'short-top') t[t.length - 1] = { ...t.at(-1)!, maxScore: fix(max - 3) };
  if (perturb === 'short-bottom') t[0] = { ...t[0]!, minScore: fix(Math.min(3, t[0]!.maxScore)) };
  if (perturb === 'outside') t[t.length - 1] = { ...t.at(-1)!, maxScore: max + 5 };
  if (perturb === 'inverted') t[0] = { ...t[0]!, minScore: t[0]!.maxScore + 1 };
  return t;
}

/** Random contiguous 0-100 scale with 2-dp boundaries and descending grade points. */
export const scaleArb = fc
  .uniqueArray(fc.integer({ min: 100, max: 9_900 }), { minLength: 2, maxLength: 8 })
  .map((raw) => {
    const cutsAsc = [...raw].sort((a, b) => a - b).map((c) => c / 100);
    const starts = [0, ...cutsAsc];
    return starts.map((start, i) => ({
      label: `G${starts.length - i}`,
      min: start,
      max: i + 1 < starts.length ? Math.round((starts[i + 1]! - 0.01) * 100) / 100 : 100,
      points: i + 1,
    }));
  });
