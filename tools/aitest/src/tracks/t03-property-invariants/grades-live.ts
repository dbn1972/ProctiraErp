/**
 * Grades commands against the live backend packages:
 * - assessment: `AssessmentService` + `ResultService` over the Prisma
 *   repositories selected in production (repository-factory.ts), as in
 *   packages/backend/assessment/src/prisma-repository.live.test.ts;
 * - gradebook: `GradebookService` over `PgGradebookRepository`, as in
 *   pg-gradebook-repository.live.test.ts.
 * Each property run gets a fresh tenant, three students, a board and a
 * random contiguous gradebook scale (grading_scales / grading_scale_bands have
 * no write API, so the scale is configured with SQL like the live tests do).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  AssessmentService,
  PrismaAssessmentItemRepository,
  PrismaAssessmentResultRepository,
  PrismaGradingSchemeRepository,
  PrismaOutcomeRepository,
  ResultService,
} from '@proctira/backend-assessment';
import { GradebookService, PgGradebookRepository } from '@proctira/backend-gradebook';
import { createPrismaClient, getSharedPgPool, withPgTenant } from '@proctira/database';
import { ensurePgTestStudent } from '@proctira/database/test-fixtures';
import fc from 'fast-check';

import { agree, attempt, pick, type CommandStats, type ViolationLog } from './core.js';
import {
  bandForAverage,
  bandForPercent,
  buildThresholds,
  GRADES_INVARIANTS,
  isApproved,
  isEditable,
  roundHalfUp,
  schemeValid,
  weightedAverage,
  WORKFLOW,
  type Action,
  type Band,
  scaleArb,
  type MItem,
  type Perturb,
  type Threshold,
  type Workflow,
} from './grades-model.js';
import type { DomainSpec, RealBase } from './runner.js';

type Pool = NonNullable<ReturnType<typeof getSharedPgPool>>;
type Prisma = ReturnType<typeof createPrismaClient>;

let prisma: Prisma | null = null;
function sharedPrisma(): Prisma {
  prisma ??= createPrismaClient({ datasourceUrl: process.env['DATABASE_URL']! });
  return prisma;
}
export async function closeGradesPrisma(): Promise<void> {
  await prisma?.$disconnect();
  prisma = null;
}

interface MScheme {
  id: string;
  min: number;
  max: number;
  thresholds: Threshold[];
}

interface MEntry {
  id: string;
  studentId: string;
  code: string;
  score: number;
  letter: string | null;
  status: Workflow;
}

export interface GradesModel {
  seq: number;
  schemes: MScheme[];
  /** subjectId -> items + scheme */
  items: Map<string, { schemeId: string; items: MItem[] }>;
  /** `${student}|${item}` -> score */
  results: Map<string, number>;
  entries: MEntry[];
}

export interface GradesReal extends RealBase {
  pool: Pool;
  tenantId: string;
  students: string[];
  subjects: string[];
  periodId: string;
  boardId: string;
  bands: Band[];
  assessment: AssessmentService;
  results: ResultService;
  gradebook: GradebookService;
}

type Cmd = fc.AsyncCommand<GradesModel, GradesReal, boolean>;

/** Stored-entry check after every gradebook command. */
async function checkEntries(m: GradesModel, r: GradesReal): Promise<void> {
  const rows = await withPgTenant(r.pool, r.tenantId, async (c) => {
    const { rows } = await c.query(
      `SELECT id, numeric_score, letter_grade, locked_at, published_at, metadata
         FROM grade_entries WHERE tenant_id = $1`,
      [r.tenantId],
    );
    return rows as Array<Record<string, unknown>>;
  });
  const labels = new Set(r.bands.map((b) => b.label));
  for (const row of rows) {
    const letter = row.letter_grade == null ? null : String(row.letter_grade);
    const score = row.numeric_score == null ? null : Number(row.numeric_score);
    if (letter !== null) {
      const band = score === null ? null : bandForPercent(score, r.bands);
      r.log.check(
        'entry-grade-matches-scale',
        labels.has(letter) && (band === null || band.label === letter),
        () =>
          `entry ${String(row.id).slice(0, 8)}: letter '${letter}' with score ${String(score)}; scale band ${band?.label ?? 'none'}; scale labels ${[...labels].join('/')}`,
      );
    }
    const e = m.entries.find((x) => x.id === row.id);
    if (!e) continue;
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const status: Workflow = row.published_at
      ? 'PUBLISHED'
      : row.locked_at
        ? 'LOCKED'
        : ((meta['workflowStatus'] as Workflow | undefined) ?? 'DRAFT');
    r.log.check(
      'workflow-transitions',
      status === e.status && (score === null || Math.abs(score - e.score) < 0.005),
      () =>
        `entry ${e.code}: stored ${status} score ${String(score)}, model ${e.status} score ${e.score}`,
    );
  }
}

abstract class GradesCommand implements Cmd {
  abstract readonly name: string;
  check(_m: Readonly<GradesModel>): boolean {
    return true;
  }
  protected abstract exec(m: GradesModel, r: GradesReal): Promise<boolean>;
  async run(m: GradesModel, r: GradesReal): Promise<void> {
    const accepted = await this.exec(m, r);
    r.stats.note(this.name, accepted);
    await checkEntries(m, r);
  }
  abstract toString(): string;
}

// ─── Assessment: schemes, items, results, subject grade ─────────────────────

class CreateScheme extends GradesCommand {
  readonly name = 'CreateScheme';
  constructor(
    readonly max: number,
    readonly cuts: number[],
    readonly step: 0.01 | 1,
    readonly perturb: Perturb,
  ) {
    super();
  }
  protected async exec(m: GradesModel, r: GradesReal) {
    const thresholds = buildThresholds(this.max, this.cuts, this.step, this.perturb);
    const v = schemeValid(0, this.max, thresholds);
    m.seq += 1;
    const got = await attempt(() =>
      r.assessment.createGradingScheme(r.tenantId, {
        name: `Scheme ${m.seq} ${randomUUID().slice(0, 6)}`,
        type: 'numeric',
        minValue: 0,
        maxValue: this.max,
        thresholds,
      }),
    );
    if (!got.ok && got.kind === 'unexpected') {
      agree(r.log, String(this), { accept: v.ok, why: v.why }, got);
      return false;
    }
    r.log.check(
      'scheme-contiguous',
      got.ok === v.ok,
      () =>
        `${String(this)} ${JSON.stringify(thresholds)}: oracle ${v.ok ? 'valid' : `invalid (${v.why})`}, service ${got.ok ? 'accepted' : `rejected: ${(got as { error: Error }).error.message}`}`,
    );
    if (!got.ok) return false;
    m.schemes.push({ id: got.value.id, min: 0, max: this.max, thresholds });
    return true;
  }
  toString() {
    return `CreateScheme(max ${this.max}, cuts ${JSON.stringify(this.cuts.map((c) => +c.toFixed(3)))}, step ${this.step}, ${this.perturb})`;
  }
}

function schemeHasResults(m: GradesModel, schemeId: string): boolean {
  for (const [, def] of m.items) {
    if (def.schemeId !== schemeId) continue;
    for (const it of def.items) {
      for (const k of m.results.keys()) if (k.endsWith(`|${it.id}`)) return true;
    }
  }
  return false;
}

function subjectHasResults(m: GradesModel, subjectId: string): boolean {
  const def = m.items.get(subjectId);
  if (!def) return false;
  return def.items.some((it) => [...m.results.keys()].some((k) => k.endsWith(`|${it.id}`)));
}

class UpdateScheme extends GradesCommand {
  readonly name = 'UpdateScheme';
  constructor(
    readonly schemeIdx: number,
    readonly cuts: number[],
    readonly perturb: Perturb,
  ) {
    super();
  }
  check(m: Readonly<GradesModel>) {
    return m.schemes.length > 0;
  }
  protected async exec(m: GradesModel, r: GradesReal) {
    const s = pick(m.schemes, this.schemeIdx)!;
    const thresholds = buildThresholds(s.max, this.cuts, 1, this.perturb);
    const v = schemeValid(s.min, s.max, thresholds);
    const frozen = schemeHasResults(m, s.id);
    const got = await attempt(() =>
      r.assessment.updateGradingScheme(r.tenantId, s.id, { thresholds }),
    );
    if (!got.ok && got.kind === 'unexpected') {
      agree(r.log, String(this), { accept: false, why: 'n/a' }, got);
      return false;
    }
    r.log.check(
      frozen ? 'scheme-frozen-after-results' : 'scheme-contiguous',
      got.ok === (v.ok && !frozen),
      () =>
        `${String(this)}: bands ${v.ok ? 'valid' : `invalid (${v.why})`}, scheme has results ${frozen}; service ${got.ok ? 'accepted' : 'rejected'}`,
    );
    if (!got.ok) return false;
    s.thresholds = thresholds;
    return true;
  }
  toString() {
    return `UpdateScheme(scheme#${this.schemeIdx}, cuts ${JSON.stringify(this.cuts.map((c) => +c.toFixed(3)))}, ${this.perturb})`;
  }
}

class DefineItems extends GradesCommand {
  readonly name = 'DefineItems';
  constructor(
    readonly subjectIdx: number,
    readonly schemeIdx: number,
    readonly weights: number[],
    readonly maxScores: number[],
  ) {
    super();
  }
  check(m: Readonly<GradesModel>) {
    return m.schemes.length > 0;
  }
  protected async exec(m: GradesModel, r: GradesReal) {
    const subjectId = pick(r.subjects, this.subjectIdx)!;
    const s = pick(m.schemes, this.schemeIdx)!;
    const total = Math.round(this.weights.reduce((a, b) => a + b, 0) * 100) / 100;
    const frozen = subjectHasResults(m, subjectId);
    const accept = total === 100 && !frozen;
    const got = await attempt(() =>
      r.assessment.defineAssessmentItems(r.tenantId, {
        subjectId,
        academicPeriodId: r.periodId,
        gradingSchemeId: s.id,
        items: this.weights.map((w, i) => ({
          name: `Item ${i + 1}`,
          weight: w,
          minScore: 0,
          maxScore: this.maxScores[i % this.maxScores.length]!,
        })),
      }),
    );
    if (!got.ok && got.kind === 'unexpected') {
      agree(r.log, String(this), { accept, why: 'n/a' }, got);
      return false;
    }
    r.log.check(
      frozen ? 'scheme-frozen-after-results' : 'model-agreement',
      got.ok === accept,
      () =>
        `${String(this)}: weights sum ${total}, subject has results ${frozen}; service ${got.ok ? 'accepted' : `rejected: ${(got as { error: Error }).error.message}`}`,
    );
    if (!got.ok) return false;
    m.items.set(subjectId, {
      schemeId: s.id,
      items: got.value.map((it) => ({
        id: it.id,
        weight: it.weight,
        minScore: it.minScore,
        maxScore: it.maxScore,
      })),
    });
    return true;
  }
  toString() {
    return `DefineItems(subject#${this.subjectIdx}, scheme#${this.schemeIdx}, weights ${JSON.stringify(this.weights)}, max ${JSON.stringify(this.maxScores)})`;
  }
}

class EnterResult extends GradesCommand {
  readonly name = 'EnterResult';
  constructor(
    readonly studentIdx: number,
    readonly subjectIdx: number,
    readonly itemIdx: number,
    readonly frac: number,
    readonly outOfRange: boolean,
  ) {
    super();
  }
  check(m: Readonly<GradesModel>) {
    return m.items.size > 0;
  }
  protected async exec(m: GradesModel, r: GradesReal) {
    const subjects = [...m.items.keys()];
    const subjectId = pick(subjects, this.subjectIdx)!;
    const def = m.items.get(subjectId)!;
    const item = pick(def.items, this.itemIdx)!;
    const studentId = pick(r.students, this.studentIdx)!;
    const score = this.outOfRange
      ? item.maxScore + 1
      : Math.round((item.minScore + this.frac * (item.maxScore - item.minScore)) * 100) / 100;
    const accept = score >= item.minScore && score <= item.maxScore;
    const got = await attempt(() =>
      r.results.enterSingleResult(r.tenantId, {
        studentId,
        assessmentItemId: item.id,
        subjectId,
        academicPeriodId: r.periodId,
        score,
      }),
    );
    if (
      !agree(
        r.log,
        String(this),
        { accept, why: `score ${score} in [${item.minScore}, ${item.maxScore}]` },
        got,
      )
    ) {
      return false;
    }
    m.results.set(`${studentId}|${item.id}`, score);
    return true;
  }
  toString() {
    return `EnterResult(student#${this.studentIdx}, subject#${this.subjectIdx}, item#${this.itemIdx}, ${this.outOfRange ? 'out of range' : this.frac.toFixed(3)})`;
  }
}

class CalculateGrade extends GradesCommand {
  readonly name = 'CalculateGrade';
  constructor(
    readonly studentIdx: number,
    readonly subjectIdx: number,
  ) {
    super();
  }
  check(m: Readonly<GradesModel>) {
    return m.items.size > 0;
  }
  protected async exec(m: GradesModel, r: GradesReal) {
    const subjects = [...m.items.keys()];
    const subjectId = pick(subjects, this.subjectIdx)!;
    const def = m.items.get(subjectId)!;
    const scheme = m.schemes.find((s) => s.id === def.schemeId)!;
    const studentId = pick(r.students, this.studentIdx)!;
    const got = await attempt(() =>
      r.results.calculateStudentGrade(r.tenantId, studentId, subjectId, r.periodId),
    );
    if (!agree(r.log, String(this), { accept: true, why: 'items defined' }, got)) return false;
    const scores = new Map<string, number>();
    for (const it of def.items) {
      const s = m.results.get(`${studentId}|${it.id}`);
      if (s !== undefined) scores.set(it.id, s);
    }
    const exp = weightedAverage(def.items, scores, scheme.min, scheme.max);
    const res = got.value;
    r.log.check(
      'subject-average',
      Math.abs(res.weightedAverage - exp.average) <= 0.011 && res.complete === exp.complete,
      () =>
        `${String(this)}: average ${res.weightedAverage} complete ${res.complete}, oracle ${exp.average} complete ${exp.complete}`,
    );
    const band = bandForAverage(res.weightedAverage, scheme.thresholds);
    r.log.check(
      'grade-matches-scale',
      res.grade === band,
      () =>
        `${String(this)}: average ${res.weightedAverage} graded '${res.grade}', configured band '${band}' of ${JSON.stringify(scheme.thresholds)}`,
    );
    return true;
  }
  toString() {
    return `CalculateGrade(student#${this.studentIdx}, subject#${this.subjectIdx})`;
  }
}

// ─── Gradebook: marks, workflow, GPA, report cards ──────────────────────────

class EnterMark extends GradesCommand {
  readonly name = 'EnterMark';
  constructor(
    readonly studentIdx: number,
    readonly codeIdx: number,
    readonly score: number,
    readonly letter: 'none' | 'match' | 'other-band' | 'unknown',
  ) {
    super();
  }
  protected async exec(m: GradesModel, r: GradesReal) {
    const studentId = pick(r.students, this.studentIdx)!;
    const code = `SUBJ-${this.codeIdx % 4}`;
    const band = bandForPercent(this.score, r.bands);
    const other = r.bands.find((b) => b.label !== band?.label);
    const letterGrade =
      this.letter === 'match'
        ? band?.label
        : this.letter === 'other-band'
          ? other?.label
          : this.letter === 'unknown'
            ? 'ZZ'
            : undefined;
    const existing = m.entries.find((e) => e.studentId === studentId && e.code === code);
    const accept = !existing || isEditable(existing.status);
    const got = await attempt(() =>
      r.gradebook.upsertGradeEntry(r.tenantId, {
        studentId,
        assessmentCode: code,
        numericScore: this.score,
        ...(letterGrade ? { letterGrade } : {}),
      }),
    );
    const why = `existing ${existing?.status ?? 'none'}`;
    if (!agree(r.log, String(this), { accept, why }, got)) return false;
    if (existing) {
      existing.score = this.score;
      existing.letter = letterGrade ?? null;
      existing.status = 'DRAFT';
    } else {
      m.entries.push({
        id: got.value.id,
        studentId,
        code,
        score: this.score,
        letter: letterGrade ?? null,
        status: 'DRAFT',
      });
    }
    return true;
  }
  toString() {
    return `EnterMark(student#${this.studentIdx}, SUBJ-${this.codeIdx % 4}, ${this.score}, letter ${this.letter})`;
  }
}

class Transition extends GradesCommand {
  readonly name: string;
  constructor(
    readonly entryIdx: number,
    readonly action: Action,
  ) {
    super();
    this.name = `Transition:${action}`;
  }
  check(m: Readonly<GradesModel>) {
    return m.entries.length > 0;
  }
  protected async exec(m: GradesModel, r: GradesReal) {
    const e = pick(m.entries, this.entryIdx)!;
    const rule = WORKFLOW[this.action];
    const accept = rule.from.includes(e.status);
    const got = await attempt(() =>
      r.gradebook.transitionGradeEntry(r.tenantId, e.id, this.action),
    );
    if (!got.ok && got.kind === 'unexpected') {
      agree(r.log, String(this), { accept, why: 'n/a' }, got);
      return false;
    }
    r.log.check(
      'workflow-transitions',
      got.ok === accept,
      () =>
        `${String(this)} on ${e.code} in ${e.status}: model ${accept ? 'allows' : 'refuses'}, service ${got.ok ? 'allowed' : 'refused'}`,
    );
    if (!got.ok) return false;
    e.status = rule.to;
    return true;
  }
  toString() {
    return `Transition(entry#${this.entryIdx}, ${this.action})`;
  }
}

/** Moves one entry along the workflow to a target stage (submit, approve, lock, publish). */
class Advance extends GradesCommand {
  readonly name = 'Advance';
  constructor(
    readonly entryIdx: number,
    readonly stage: 'APPROVED' | 'LOCKED' | 'PUBLISHED',
  ) {
    super();
  }
  check(m: Readonly<GradesModel>) {
    return m.entries.length > 0;
  }
  protected async exec(m: GradesModel, r: GradesReal) {
    const e = pick(m.entries, this.entryIdx)!;
    const order: Workflow[] = ['SUBMITTED', 'APPROVED', 'LOCKED', 'PUBLISHED'];
    const next: Partial<Record<Workflow, Action>> = {
      DRAFT: 'submit',
      REJECTED: 'submit',
      SUBMITTED: 'approve',
      APPROVED: 'lock',
      LOCKED: 'publish',
    };
    let steps = 0;
    while (order.indexOf(e.status) < order.indexOf(this.stage) && steps < 5) {
      const action = next[e.status]!;
      steps += 1;
      const got = await attempt(() => r.gradebook.transitionGradeEntry(r.tenantId, e.id, action));
      if (
        !agree(
          r.log,
          `${String(this)} ${action} from ${e.status}`,
          { accept: true, why: 'allowed step' },
          got,
        )
      ) {
        return false;
      }
      e.status = WORKFLOW[action].to;
    }
    return true;
  }
  toString() {
    return `Advance(entry#${this.entryIdx}, ${this.stage})`;
  }
}

class ComputeGpa extends GradesCommand {
  readonly name = 'ComputeGpa';
  constructor(readonly studentIdx: number) {
    super();
  }
  protected async exec(m: GradesModel, r: GradesReal) {
    const studentId = pick(r.students, this.studentIdx)!;
    const approved = m.entries.filter((e) => e.studentId === studentId && isApproved(e.status));
    const got = await attempt(() => r.gradebook.computeGpa(r.tenantId, { studentId }));
    const why = `${approved.length} approved entries`;
    if (!agree(r.log, String(this), { accept: approved.length > 0, why }, got)) return false;
    const courses = got.value.detail.courses;
    const points = approved.map((e) => bandForPercent(e.score, r.bands)?.points ?? null);
    const valid = points.filter((p): p is number => p !== null);
    const expected =
      valid.length > 0 ? roundHalfUp(valid.reduce((a, b) => a + b, 0) / valid.length, 3) : null;
    const lettersOk = courses.every((c) => {
      const band = c.numericScore == null ? null : bandForPercent(c.numericScore, r.bands);
      return band === null || c.letterGrade === band.label;
    });
    r.log.check(
      'gpa-matches-scale',
      courses.length === approved.length &&
        lettersOk &&
        got.value.snapshot.weightedGpa !== null &&
        expected !== null &&
        Math.abs(Number(got.value.snapshot.weightedGpa) - expected) < 0.0006,
      () =>
        `${String(this)}: GPA ${String(got.value.snapshot.weightedGpa)} over ${courses.length} course(s) ${JSON.stringify(courses.map((c) => [c.courseCode, c.numericScore, c.letterGrade, c.gradePoints]))}; expected ${String(expected)} over ${approved.length} approved on the scale ${JSON.stringify(r.bands.map((b) => [b.label, b.min, b.max, b.points]))}`,
    );
    return true;
  }
  toString() {
    return `ComputeGpa(student#${this.studentIdx})`;
  }
}

class ReportCard extends GradesCommand {
  readonly name = 'ReportCard';
  constructor(readonly studentIdx: number) {
    super();
  }
  protected async exec(m: GradesModel, r: GradesReal) {
    const studentId = pick(r.students, this.studentIdx)!;
    const published = m.entries.filter(
      (e) => e.studentId === studentId && e.status === 'PUBLISHED',
    );
    const got = await attempt(() =>
      r.gradebook.createReportCardJob(r.tenantId, { studentId, boardId: r.boardId }),
    );
    if (!agree(r.log, String(this), { accept: true, why: 'student and board exist' }, got)) {
      return false;
    }
    const job = got.value;
    let listed: string[] = [];
    if (job.artifactUri) {
      const html = readFileSync(job.artifactUri, 'utf8');
      listed = [...html.matchAll(/<li>([^:<]+):/g)].map((x) => x[1]!).sort();
    }
    const expected = published.map((e) => e.code).sort();
    r.log.check(
      'report-card-published-only',
      job.status === 'SUCCEEDED' &&
        Number(job.metadata['gradeCount']) === published.length &&
        JSON.stringify(listed) === JSON.stringify(expected),
      () =>
        `${String(this)}: job ${job.status}, gradeCount ${String(job.metadata['gradeCount'])}, lists ${JSON.stringify(listed)}, published ${JSON.stringify(expected)}`,
    );
    return true;
  }
  toString() {
    return `ReportCard(student#${this.studentIdx})`;
  }
}

// ─── Arbitraries and spec ────────────────────────────────────────────────────

const idx = fc.nat({ max: 40 });
const cuts = fc.array(fc.double({ min: 0.05, max: 0.95, noNaN: true }), {
  minLength: 1,
  maxLength: 6,
});
const perturb = fc.oneof(
  { weight: 5, arbitrary: fc.constant<Perturb>('none') },
  {
    weight: 3,
    arbitrary: fc.constantFrom<Perturb>(
      'overlap',
      'gap',
      'short-top',
      'short-bottom',
      'outside',
      'inverted',
    ),
  },
);
const weights = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom(
      [100],
      [40, 60],
      [30, 30, 40],
      [20, 30, 50],
      [25, 25, 25, 25],
      [33.33, 33.33, 33.34],
    ),
  },
  { weight: 1, arbitrary: fc.constantFrom([40, 50], [60, 60], [99.99]) },
);
const score2dp = fc.integer({ min: 0, max: 10_000 }).map((n) => n / 100);

function weighted<T>(pairs: Array<[fc.Arbitrary<T>, number]>): Array<fc.Arbitrary<T>> {
  return pairs.flatMap(([a, w]) => Array.from({ length: w }, () => a));
}

export const gradesCommands: Array<fc.Arbitrary<Cmd>> = weighted<Cmd>([
  [
    fc
      .tuple(fc.constantFrom(100, 10, 4, 50), cuts, fc.constantFrom<0.01 | 1>(0.01, 1), perturb)
      .map(([mx, c, st, p]) => new CreateScheme(mx, c, st, p)),
    2,
  ],
  [fc.tuple(idx, cuts, perturb).map(([i, c, p]) => new UpdateScheme(i, c, p)), 1],
  [
    fc
      .tuple(
        idx,
        idx,
        weights,
        fc.array(fc.constantFrom(10, 20, 25, 50, 100), { minLength: 1, maxLength: 4 }),
      )
      .map(([s, sc, w, mx]) => new DefineItems(s, sc, [...w], mx)),
    2,
  ],
  [
    fc
      .tuple(
        idx,
        idx,
        idx,
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.oneof({ weight: 9, arbitrary: fc.constant(false) }, fc.constant(true)),
      )
      .map(([st, sb, it, f, o]) => new EnterResult(st, sb, it, f, o)),
    4,
  ],
  [fc.tuple(idx, idx).map(([st, sb]) => new CalculateGrade(st, sb)), 2],
  [
    fc
      .tuple(
        idx,
        idx,
        score2dp,
        fc.constantFrom(
          'none' as const,
          'none' as const,
          'match' as const,
          'other-band' as const,
          'unknown' as const,
        ),
      )
      .map(([st, c, s, l]) => new EnterMark(st, c, s, l)),
    4,
  ],
  [
    fc
      .tuple(
        idx,
        fc.constantFrom<Action>(
          'submit',
          'submit',
          'approve',
          'approve',
          'reject',
          'lock',
          'publish',
          'reopen',
        ),
      )
      .map(([e, a]) => new Transition(e, a)),
    6,
  ],
  [
    fc
      .tuple(idx, fc.constantFrom('APPROVED' as const, 'LOCKED' as const, 'PUBLISHED' as const))
      .map(([e, st]) => new Advance(e, st)),
    3,
  ],
  [idx.map((s) => new ComputeGpa(s)), 2],
  [idx.map((s) => new ReportCard(s)), 1],
]);

export function gradesSpec(): DomainSpec<GradesModel, GradesReal, Band[]> {
  return {
    domain: 'grades',
    invariants: GRADES_INVARIANTS,
    commands: gradesCommands,
    config: scaleArb,
    maxCommands: 40,
    async setup(log: ViolationLog, stats: CommandStats, bands: Band[]) {
      const pool = getSharedPgPool();
      if (!pool) throw new Error('DATABASE_URL is required for the grades property');
      const tenantId = randomUUID();
      const students = [randomUUID(), randomUUID(), randomUUID()];
      for (const s of students) await ensurePgTestStudent(pool, tenantId, s);
      const boardId = randomUUID();
      const scaleId = randomUUID();
      await withPgTenant(pool, tenantId, async (c) => {
        await c.query(
          `INSERT INTO boards (id, tenant_id, name, code, type) VALUES ($1, $2, 'Prop Board', $3, 'STATE')`,
          [boardId, tenantId, `PB-${boardId.slice(0, 8)}`],
        );
        await c.query(
          `INSERT INTO grading_scales (id, tenant_id, board_id, code, name, is_default)
           VALUES ($1, $2, $3, 'PROP', 'Property scale', true)`,
          [scaleId, tenantId, boardId],
        );
        for (const [i, b] of bands.entries()) {
          await c.query(
            `INSERT INTO grading_scale_bands
               (tenant_id, grading_scale_id, label, min_percent, max_percent, grade_points, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [tenantId, scaleId, b.label, b.min, b.max, b.points, i + 1],
          );
        }
      });
      const db = sharedPrisma();
      const schemeRepo = new PrismaGradingSchemeRepository(db);
      const itemRepo = new PrismaAssessmentItemRepository(db);
      const resultRepo = new PrismaAssessmentResultRepository(db);
      return {
        model: { seq: 0, schemes: [], items: new Map(), results: new Map(), entries: [] },
        real: {
          log,
          stats,
          pool,
          tenantId,
          students,
          subjects: [randomUUID(), randomUUID()],
          periodId: randomUUID(),
          boardId,
          bands,
          assessment: new AssessmentService(
            schemeRepo,
            itemRepo,
            new PrismaOutcomeRepository(db),
            resultRepo,
          ),
          results: new ResultService(resultRepo, itemRepo, schemeRepo),
          gradebook: new GradebookService(new PgGradebookRepository(pool)),
        },
      };
    },
  };
}
