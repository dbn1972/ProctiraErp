/**
 * Pure GPA / letter-band engine (WS3).
 * Board-configurable via bands + policy hooks — no I/O.
 */

export type GradeBand = {
  label: string;
  minPercent: number;
  maxPercent: number;
  gradePoints: number | null;
};

export type GpaPolicy = {
  /** Minimum percent to earn credit / count as pass. Default 33. */
  passingPercent?: number;
  /** Cap for grade-point scale (e.g. 10 CBSE, 4 US). Default 10. */
  maxGradePoints?: number;
  /** How course weight is applied for weighted GPA. */
  weightMode?: 'CREDITS' | 'EXPLICIT';
  /** Decimal places for GPA output. Default 3. */
  roundTo?: number;
};

export type CourseGradeInput = {
  courseCode: string;
  /** Percent score 0–100 when numeric. */
  numericScore?: number | null;
  letterGrade?: string | null;
  /** Attempted credits for this course. */
  credits: number;
  /** Explicit weight when weightMode=EXPLICIT (defaults to credits). */
  weight?: number;
  /** When false, exclude from GPA numerator/denominator but may still earn credit. */
  includeInGpa?: boolean;
  /** Override pass/fail; otherwise derived from percent vs passingPercent. */
  passed?: boolean;
};

export type CourseGpaResult = {
  courseCode: string;
  numericScore: number | null;
  letterGrade: string | null;
  gradePoints: number | null;
  credits: number;
  creditsEarned: number;
  weight: number;
  includeInGpa: boolean;
  passed: boolean;
};

export type GpaSnapshotResult = {
  unweightedGpa: number | null;
  weightedGpa: number | null;
  creditsAttempted: number;
  creditsEarned: number;
  courses: CourseGpaResult[];
};

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/** Resolve band for a percent score (inclusive min, inclusive max). */
export function resolveBandFromPercent(
  percent: number,
  bands: GradeBand[],
): GradeBand | null {
  if (!Number.isFinite(percent)) return null;
  const sorted = [...bands].sort((a, b) => b.minPercent - a.minPercent);
  for (const band of sorted) {
    if (percent >= band.minPercent && percent <= band.maxPercent) {
      return band;
    }
  }
  // Edge: exactly at boundary gaps — fall back to nearest lower band
  for (const band of sorted) {
    if (percent >= band.minPercent) return band;
  }
  return null;
}

export function resolveBandFromLetter(
  letter: string,
  bands: GradeBand[],
): GradeBand | null {
  const needle = letter.trim().toUpperCase();
  return (
    bands.find((b) => b.label.trim().toUpperCase() === needle) ?? null
  );
}

export function resolveGradePoints(
  input: { numericScore?: number | null; letterGrade?: string | null },
  bands: GradeBand[],
  policy: GpaPolicy = {},
): { letterGrade: string | null; gradePoints: number | null; band: GradeBand | null } {
  const maxGp = policy.maxGradePoints ?? 10;
  let band: GradeBand | null = null;
  if (input.letterGrade) {
    band = resolveBandFromLetter(input.letterGrade, bands);
  }
  if (!band && input.numericScore != null) {
    band = resolveBandFromPercent(input.numericScore, bands);
  }
  if (!band) {
    return { letterGrade: input.letterGrade ?? null, gradePoints: null, band: null };
  }
  const raw = band.gradePoints;
  const gp =
    raw == null || !Number.isFinite(raw)
      ? null
      : Math.min(maxGp, Math.max(0, Number(raw)));
  return { letterGrade: band.label, gradePoints: gp, band };
}

/**
 * Credits earned for one course given a credit rule + score.
 * Board hooks live in rule.metadata (minPercent, requirePass).
 */
export function applyCreditRule(
  rule: {
    credits: number;
    metadata?: {
      minPercent?: number;
      requirePass?: boolean;
      partialCredit?: boolean;
    };
  },
  opts: { numericScore?: number | null; passed?: boolean },
): { creditsEarned: number; completed: boolean } {
  const minPercent = rule.metadata?.minPercent ?? 33;
  const requirePass = rule.metadata?.requirePass !== false;
  const score = opts.numericScore;
  const passed =
    opts.passed ??
    (score != null && Number.isFinite(score) ? score >= minPercent : false);

  if (requirePass && !passed) {
    return { creditsEarned: 0, completed: false };
  }
  if (
    rule.metadata?.partialCredit &&
    score != null &&
    Number.isFinite(score) &&
    score < 100
  ) {
    const ratio = Math.max(0, Math.min(1, score / 100));
    return {
      creditsEarned: round(rule.credits * ratio, 2),
      completed: passed,
    };
  }
  return { creditsEarned: rule.credits, completed: true };
}

export function computeGpaSnapshot(
  courses: CourseGradeInput[],
  bands: GradeBand[],
  policy: GpaPolicy = {},
): GpaSnapshotResult {
  const passingPercent = policy.passingPercent ?? 33;
  const weightMode = policy.weightMode ?? 'CREDITS';
  const roundTo = policy.roundTo ?? 3;

  const results: CourseGpaResult[] = courses.map((course) => {
    const resolved = resolveGradePoints(
      { numericScore: course.numericScore, letterGrade: course.letterGrade },
      bands,
      policy,
    );
    const passed =
      course.passed ??
      (course.numericScore != null
        ? course.numericScore >= passingPercent
        : (resolved.gradePoints ?? 0) > 0);
    const creditOutcome = applyCreditRule(
      {
        credits: course.credits,
        metadata: { minPercent: passingPercent, requirePass: true },
      },
      { numericScore: course.numericScore, passed },
    );
    const weight =
      weightMode === 'EXPLICIT'
        ? (course.weight ?? course.credits)
        : course.credits;
    return {
      courseCode: course.courseCode,
      numericScore: course.numericScore ?? null,
      letterGrade: resolved.letterGrade,
      gradePoints: resolved.gradePoints,
      credits: course.credits,
      creditsEarned: creditOutcome.creditsEarned,
      weight,
      includeInGpa: course.includeInGpa !== false,
      passed,
    };
  });

  let unweightedNum = 0;
  let unweightedDen = 0;
  let weightedNum = 0;
  let weightedDen = 0;
  let creditsAttempted = 0;
  let creditsEarned = 0;

  for (const row of results) {
    creditsAttempted += row.credits;
    creditsEarned += row.creditsEarned;
    if (!row.includeInGpa || row.gradePoints == null) continue;
    unweightedNum += row.gradePoints;
    unweightedDen += 1;
    weightedNum += row.gradePoints * row.weight;
    weightedDen += row.weight;
  }

  return {
    unweightedGpa:
      unweightedDen > 0 ? round(unweightedNum / unweightedDen, roundTo) : null,
    weightedGpa:
      weightedDen > 0 ? round(weightedNum / weightedDen, roundTo) : null,
    creditsAttempted: round(creditsAttempted, 2),
    creditsEarned: round(creditsEarned, 2),
    courses: results,
  };
}
