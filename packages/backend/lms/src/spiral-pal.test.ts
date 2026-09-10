/**
 * Spiral PAL engine — unit + property tests (G-802).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  applyAttempt,
  buildSpiralPlan,
  gradeQuiz,
  INITIAL_MASTERY,
  intervalForStreak,
  MASTERY_THRESHOLD,
  SPIRAL_INTERVALS_DAYS,
  type MasteryState,
} from './spiral-pal.js';

const NOW = new Date('2026-09-08T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const masteryStateArb: fc.Arbitrary<MasteryState> = fc.record({
  mastery: fc.double({ min: 0, max: 1, noNaN: true }),
  attempts: fc.nat({ max: 500 }),
  correct: fc.nat({ max: 500 }),
  streak: fc.nat({ max: 20 }),
  intervalDays: fc.constantFrom(0, ...SPIRAL_INTERVALS_DAYS),
  dueAt: fc.option(fc.date({ min: new Date(0), max: new Date('2100-01-01') }), { nil: null }),
  lastReviewedAt: fc.option(fc.date({ min: new Date(0), max: new Date('2100-01-01') }), {
    nil: null,
  }),
});

describe('applyAttempt', () => {
  it('grows the interval along the spiral on consecutive correct answers', () => {
    let state = INITIAL_MASTERY;
    const seen: number[] = [];
    for (let i = 0; i < SPIRAL_INTERVALS_DAYS.length + 2; i += 1) {
      state = applyAttempt(state, { correct: true, now: NOW });
      seen.push(state.intervalDays);
    }
    expect(seen.slice(0, SPIRAL_INTERVALS_DAYS.length)).toEqual([...SPIRAL_INTERVALS_DAYS]);
    expect(seen.at(-1)).toBe(SPIRAL_INTERVALS_DAYS.at(-1));
    expect(state.dueAt?.getTime()).toBe(NOW.getTime() + 60 * DAY);
  });

  it('collapses the interval and resets the streak on a miss', () => {
    let state = INITIAL_MASTERY;
    for (let i = 0; i < 4; i += 1) state = applyAttempt(state, { correct: true, now: NOW });
    expect(state.streak).toBe(4);
    const after = applyAttempt(state, { correct: false, now: NOW });
    expect(after.streak).toBe(0);
    expect(after.intervalDays).toBe(SPIRAL_INTERVALS_DAYS[0]);
    expect(after.dueAt?.getTime()).toBe(NOW.getTime() + DAY);
    expect(after.mastery).toBeLessThan(state.mastery);
  });

  it('reaches mastery after a handful of correct answers', () => {
    let state = INITIAL_MASTERY;
    let steps = 0;
    while (state.mastery < MASTERY_THRESHOLD && steps < 20) {
      state = applyAttempt(state, { correct: true, now: NOW });
      steps += 1;
    }
    expect(steps).toBeLessThanOrEqual(6);
  });

  it('property: mastery stays in [0,1] and moves in the answer direction', () => {
    fc.assert(
      fc.property(
        masteryStateArb,
        fc.boolean(),
        fc.option(fc.nat({ max: 60_000 })),
        (state, correct, rt) => {
          const next = applyAttempt(state, { correct, responseTimeMs: rt, now: NOW });
          expect(next.mastery).toBeGreaterThanOrEqual(0);
          expect(next.mastery).toBeLessThanOrEqual(1);
          const base = Math.min(1, Math.max(0, state.mastery));
          if (correct) expect(next.mastery).toBeGreaterThanOrEqual(base - 1e-9);
          else expect(next.mastery).toBeLessThanOrEqual(base + 1e-9);
          expect(next.attempts).toBe(state.attempts + 1);
          expect(next.correct).toBe(state.correct + (correct ? 1 : 0));
          expect(next.streak).toBe(correct ? state.streak + 1 : 0);
          expect(SPIRAL_INTERVALS_DAYS).toContain(next.intervalDays);
          expect(next.dueAt?.getTime()).toBe(NOW.getTime() + next.intervalDays * DAY);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('intervalForStreak is monotonic and capped', () => {
    for (let s = 1; s < 30; s += 1) {
      expect(intervalForStreak(s)).toBeGreaterThanOrEqual(intervalForStreak(s - 1));
    }
    expect(intervalForStreak(999)).toBe(SPIRAL_INTERVALS_DAYS.at(-1));
  });
});

describe('buildSpiralPlan', () => {
  const skills = [
    { id: 'a', name: 'Fractions', subject: 'Maths', prerequisiteSkillIds: [] },
    { id: 'b', name: 'Decimals', subject: 'Maths', prerequisiteSkillIds: ['a'] },
    { id: 'c', name: 'Percentages', subject: 'Maths', prerequisiteSkillIds: ['b'] },
    { id: 'd', name: 'Nouns', subject: 'English', prerequisiteSkillIds: [] },
  ];

  it('orders due reviews first, then reinforcement, then introductions; blocks locked skills', () => {
    const plan = buildSpiralPlan({
      skills,
      mastery: [
        { skillId: 'a', mastery: 0.9, dueAt: new Date(NOW.getTime() - DAY), streak: 3 },
        { skillId: 'b', mastery: 0.3, dueAt: new Date(NOW.getTime() + 5 * DAY), streak: 0 },
      ],
      now: NOW,
    });
    expect(plan.items.map((i) => `${i.type}:${i.skillId}`)).toEqual([
      'review:a',
      'reinforce:b',
      'introduce:d',
    ]);
    // c is blocked because b (its prerequisite) is not mastered yet.
    expect(plan.blockedSkillIds).toEqual(['c']);
    expect(plan.summary).toEqual({
      dueReviews: 1,
      mastered: 1,
      inProgress: 1,
      notStarted: 1,
      blocked: 1,
    });
  });

  it('property: never schedules blocked skills, never duplicates, respects limit', () => {
    const skillArb = fc
      .array(fc.uuid(), { minLength: 1, maxLength: 12 })
      .map((ids) => Array.from(new Set(ids)))
      .chain((ids) =>
        fc.tuple(
          fc.constant(ids),
          fc.array(fc.nat({ max: Math.max(0, ids.length - 1) }), {
            minLength: ids.length,
            maxLength: ids.length,
          }),
        ),
      )
      .map(([ids, prereqIdx]) =>
        ids.map((id, i) => ({
          id,
          name: `Skill ${i}`,
          subject: 'S',
          // Only earlier skills can be prerequisites so the graph is acyclic.
          prerequisiteSkillIds: i > 0 && prereqIdx[i]! < i ? [ids[prereqIdx[i]!]!] : [],
        })),
      );

    fc.assert(
      fc.property(
        skillArb,
        fc.integer({ min: 1, max: 20 }),
        fc.nat({ max: 100 }),
        (sk, limit, seed) => {
          const mastery = sk
            .filter((_, i) => (i + seed) % 3 !== 0)
            .map((s, i) => ({
              skillId: s.id,
              mastery: ((i * 37 + seed) % 100) / 100,
              dueAt: new Date(NOW.getTime() + (((i + seed) % 5) - 2) * DAY),
              streak: i % 4,
            }));
          const plan = buildSpiralPlan({ skills: sk, mastery, now: NOW, limit });
          const ids = plan.items.map((i) => i.skillId);
          expect(new Set(ids).size).toBe(ids.length);
          expect(ids.length).toBeLessThanOrEqual(limit);
          for (const blocked of plan.blockedSkillIds) expect(ids).not.toContain(blocked);
          const types = plan.items.map((i) => i.type);
          const firstReinforce = types.indexOf('reinforce');
          const firstIntroduce = types.indexOf('introduce');
          const lastReview = types.lastIndexOf('review');
          if (firstReinforce >= 0) expect(lastReview).toBeLessThan(firstReinforce);
          if (firstIntroduce >= 0 && firstReinforce >= 0) {
            expect(types.lastIndexOf('reinforce')).toBeLessThan(firstIntroduce);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('gradeQuiz', () => {
  const questions = [
    { id: 'q1', correctOptionIndex: 0, points: 2, skillId: 'a' },
    { id: 'q2', correctOptionIndex: 3, points: 1, skillId: null },
    { id: 'q3', correctOptionIndex: 1, points: 1, skillId: 'b' },
  ];

  it('scores only matching answers and ignores unknown questions', () => {
    const result = gradeQuiz(questions, [
      { questionId: 'q1', selectedOptionIndex: 0 },
      { questionId: 'q2', selectedOptionIndex: 1 },
      { questionId: 'zzz', selectedOptionIndex: 0 },
    ]);
    expect(result).toEqual({
      score: 2,
      maxScore: 4,
      results: [
        { questionId: 'q1', correct: true, skillId: 'a' },
        { questionId: 'q2', correct: false, skillId: null },
        { questionId: 'q3', correct: false, skillId: 'b' },
      ],
    });
  });

  it('property: 0 ≤ score ≤ maxScore', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            questionId: fc.constantFrom('q1', 'q2', 'q3', 'q9'),
            selectedOptionIndex: fc.nat({ max: 4 }),
          }),
        ),
        (answers) => {
          const r = gradeQuiz(questions, answers);
          expect(r.score).toBeGreaterThanOrEqual(0);
          expect(r.score).toBeLessThanOrEqual(r.maxScore);
        },
      ),
    );
  });
});
