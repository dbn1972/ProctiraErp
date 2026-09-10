/**
 * Spiral PAL — Personalised Adaptive Learning engine (Wave 8 / G-802).
 *
 * Pure, deterministic functions (no I/O) so the scheduling rules can be
 * property-tested. Two ideas:
 *
 *  1. Mastery estimate per (student, skill) updated by an exponential moving
 *     average — correct answers move mastery toward 1, incorrect toward 0.
 *  2. Spiral review — a skill re-enters the learner's plan on a growing
 *     interval (1 → 3 → 7 → 14 → 30 → 60 days) while the streak holds, and
 *     collapses to the shortest interval on any miss so the concept spirals
 *     back for re-teaching.
 */

export const SPIRAL_INTERVALS_DAYS: readonly number[] = [1, 3, 7, 14, 30, 60];
export const MASTERY_THRESHOLD = 0.8;
export const STRUGGLING_THRESHOLD = 0.4;
const LEARNING_RATE = 0.3;
const FORGET_RATE = 0.45;
const FAST_RESPONSE_MS = 5_000;
const FAST_RESPONSE_BONUS = 0.05;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface MasteryState {
  mastery: number;
  attempts: number;
  correct: number;
  streak: number;
  intervalDays: number;
  dueAt: Date | null;
  lastReviewedAt: Date | null;
}

export interface AttemptInput {
  correct: boolean;
  responseTimeMs?: number | null;
  now: Date;
}

export const INITIAL_MASTERY: MasteryState = {
  mastery: 0,
  attempts: 0,
  correct: 0,
  streak: 0,
  intervalDays: 0,
  dueAt: null,
  lastReviewedAt: null,
};

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Round to 4 dp so Postgres NUMERIC round-trips exactly. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function intervalForStreak(streak: number): number {
  if (streak <= 0) return SPIRAL_INTERVALS_DAYS[0]!;
  const index = Math.min(streak - 1, SPIRAL_INTERVALS_DAYS.length - 1);
  return SPIRAL_INTERVALS_DAYS[index]!;
}

/**
 * Apply one attempt to the mastery state.
 * Invariants (property-tested): mastery ∈ [0,1]; a correct attempt never
 * lowers mastery; an incorrect attempt never raises it; a miss resets the
 * streak and collapses the interval to the shortest step.
 */
export function applyAttempt(state: MasteryState, input: AttemptInput): MasteryState {
  const base = clamp01(state.mastery);
  let mastery: number;
  if (input.correct) {
    mastery = base + LEARNING_RATE * (1 - base);
    if (
      typeof input.responseTimeMs === 'number' &&
      input.responseTimeMs >= 0 &&
      input.responseTimeMs <= FAST_RESPONSE_MS
    ) {
      mastery += FAST_RESPONSE_BONUS;
    }
  } else {
    mastery = base * (1 - FORGET_RATE);
  }
  mastery = round4(clamp01(mastery));
  if (input.correct && mastery < base) mastery = base;
  if (!input.correct && mastery > base) mastery = base;

  const streak = input.correct ? state.streak + 1 : 0;
  const intervalDays = input.correct ? intervalForStreak(streak) : SPIRAL_INTERVALS_DAYS[0]!;
  const dueAt = new Date(input.now.getTime() + intervalDays * DAY_MS);

  return {
    mastery,
    attempts: state.attempts + 1,
    correct: state.correct + (input.correct ? 1 : 0),
    streak,
    intervalDays,
    dueAt,
    lastReviewedAt: input.now,
  };
}

export type PlanItemType = 'review' | 'reinforce' | 'introduce';

export interface PlanSkill {
  id: string;
  name: string;
  subject: string;
  prerequisiteSkillIds: string[];
}

export interface PlanMastery {
  skillId: string;
  mastery: number;
  dueAt: Date | null;
  streak: number;
}

export interface PlanItem {
  type: PlanItemType;
  skillId: string;
  skillName: string;
  subject: string;
  mastery: number;
  dueAt: Date | null;
  reason: string;
}

export interface SpiralPlan {
  generatedAt: Date;
  items: PlanItem[];
  blockedSkillIds: string[];
  summary: {
    dueReviews: number;
    mastered: number;
    inProgress: number;
    notStarted: number;
    blocked: number;
  };
}

export interface BuildPlanInput {
  skills: PlanSkill[];
  mastery: PlanMastery[];
  now: Date;
  limit?: number;
}

/**
 * Build today's plan for a learner.
 * Ordering: overdue/due reviews (lowest mastery first) → reinforcement of
 * struggling skills → new skills whose prerequisites are mastered.
 * Skills with an unmastered prerequisite are reported as blocked, never
 * scheduled.
 */
export function buildSpiralPlan(input: BuildPlanInput): SpiralPlan {
  const limit = Math.max(1, input.limit ?? 10);
  const skillById = new Map(input.skills.map((s) => [s.id, s]));
  const masteryBySkill = new Map(input.mastery.map((m) => [m.skillId, m]));

  const isMastered = (skillId: string): boolean =>
    (masteryBySkill.get(skillId)?.mastery ?? 0) >= MASTERY_THRESHOLD;

  const reviews: PlanItem[] = [];
  const reinforce: PlanItem[] = [];
  const introduce: PlanItem[] = [];
  const blocked: string[] = [];
  let mastered = 0;
  let inProgress = 0;
  let notStarted = 0;

  for (const skill of input.skills) {
    const m = masteryBySkill.get(skill.id);
    if (!m) {
      const prereqsKnown = skill.prerequisiteSkillIds.filter((id) => skillById.has(id));
      const ready = prereqsKnown.every(isMastered);
      if (ready) {
        notStarted += 1;
        introduce.push({
          type: 'introduce',
          skillId: skill.id,
          skillName: skill.name,
          subject: skill.subject,
          mastery: 0,
          dueAt: null,
          reason: 'prerequisites_mastered',
        });
      } else {
        blocked.push(skill.id);
      }
      continue;
    }

    if (m.mastery >= MASTERY_THRESHOLD) mastered += 1;
    else inProgress += 1;

    const due = m.dueAt != null && m.dueAt.getTime() <= input.now.getTime();
    if (due) {
      reviews.push({
        type: 'review',
        skillId: skill.id,
        skillName: skill.name,
        subject: skill.subject,
        mastery: m.mastery,
        dueAt: m.dueAt,
        reason: m.mastery >= MASTERY_THRESHOLD ? 'spiral_review_due' : 'review_due_below_mastery',
      });
    } else if (m.mastery < STRUGGLING_THRESHOLD) {
      reinforce.push({
        type: 'reinforce',
        skillId: skill.id,
        skillName: skill.name,
        subject: skill.subject,
        mastery: m.mastery,
        dueAt: m.dueAt,
        reason: 'struggling',
      });
    }
  }

  reviews.sort((a, b) => a.mastery - b.mastery || dueTime(a) - dueTime(b));
  reinforce.sort((a, b) => a.mastery - b.mastery);

  const items = [...reviews, ...reinforce, ...introduce].slice(0, limit);

  return {
    generatedAt: input.now,
    items,
    blockedSkillIds: blocked,
    summary: {
      dueReviews: reviews.length,
      mastered,
      inProgress,
      notStarted,
      blocked: blocked.length,
    },
  };
}

function dueTime(item: PlanItem): number {
  return item.dueAt ? item.dueAt.getTime() : Number.MAX_SAFE_INTEGER;
}

/** Score a multiple-choice quiz. Returns per-question correctness and total. */
export function gradeQuiz(
  questions: ReadonlyArray<{
    id: string;
    correctOptionIndex: number;
    points: number;
    skillId: string | null;
  }>,
  answers: ReadonlyArray<{ questionId: string; selectedOptionIndex: number }>,
): {
  score: number;
  maxScore: number;
  results: Array<{ questionId: string; correct: boolean; skillId: string | null }>;
} {
  const answerByQuestion = new Map(answers.map((a) => [a.questionId, a.selectedOptionIndex]));
  let score = 0;
  let maxScore = 0;
  const results = questions.map((q) => {
    maxScore += q.points;
    const selected = answerByQuestion.get(q.id);
    const correct = selected !== undefined && selected === q.correctOptionIndex;
    if (correct) score += q.points;
    return { questionId: q.id, correct, skillId: q.skillId };
  });
  return { score: round4(score), maxScore: round4(maxScore), results };
}
