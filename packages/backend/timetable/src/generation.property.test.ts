/**
 * Property: generated assignments have 0 hard clashes (G-917).
 *
 * Randomised section × subject × teacher × room × period instances; ≥50 runs.
 * Unassigned leftover is allowed when the instance is over-constrained; the
 * assignment set itself must never double-book teacher, room, or section, nor
 * violate availability or room capacity.
 */
import { randomUUID } from 'node:crypto';

import * as fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import {
  countHardClashes,
  generateTimetable,
  type GenerateInput,
  type GeneratorDemand,
  type GeneratorPeriod,
  type GeneratorRoom,
} from './generation.js';

// Property-based runs are CPU-heavy; the 5s default flaked on loaded CI runners.
vi.setConfig({ testTimeout: 30_000 });

function uuid(): string {
  return randomUUID();
}

const periodArb: fc.Arbitrary<GeneratorPeriod[]> = fc.integer({ min: 3, max: 6 }).map((n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p-${i + 1}`,
    periodOrder: i + 1,
    startTime: `${String(8 + i).padStart(2, '0')}:00`,
    endTime: `${String(8 + i).padStart(2, '0')}:45`,
  })),
);

const roomArb: fc.Arbitrary<GeneratorRoom[]> = fc.integer({ min: 2, max: 5 }).map((n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `room-${i + 1}`,
    capacity: 30 + i * 5,
  })),
);

function inputArb(): fc.Arbitrary<GenerateInput> {
  return fc
    .record({
      periods: periodArb,
      rooms: roomArb,
      sectionCount: fc.integer({ min: 1, max: 4 }),
      subjectCount: fc.integer({ min: 1, max: 4 }),
      teacherCount: fc.integer({ min: 2, max: 8 }),
      periodsPerWeek: fc.integer({ min: 1, max: 3 }),
      enroll: fc.integer({ min: 10, max: 28 }),
      maxPerDay: fc.integer({ min: 4, max: 8 }),
      unavailableCount: fc.integer({ min: 0, max: 3 }),
    })
    .map((cfg) => {
      const sections = Array.from({ length: cfg.sectionCount }, () => uuid());
      const subjects = Array.from({ length: cfg.subjectCount }, () => uuid());
      const teachers = Array.from({ length: cfg.teacherCount }, () => uuid());
      const demands: GeneratorDemand[] = [];
      let t = 0;
      for (const sectionId of sections) {
        for (const subjectId of subjects) {
          demands.push({
            id: uuid(),
            sectionId,
            subjectId,
            staffId: teachers[t % teachers.length]!,
            periodsPerWeek: cfg.periodsPerWeek,
            preferredRoomId: cfg.rooms[t % cfg.rooms.length]?.id ?? null,
            enrollmentCount: cfg.enroll,
          });
          t += 1;
        }
      }
      const days = [1, 2, 3, 4, 5];
      const unavailable = Array.from({ length: cfg.unavailableCount }, (_, i) => ({
        staffId: teachers[i % teachers.length]!,
        dayOfWeek: days[i % days.length]!,
        periodId: cfg.periods[i % cfg.periods.length]!.id,
      }));
      return {
        daysOfWeek: days,
        periods: cfg.periods,
        rooms: cfg.rooms,
        demands,
        unavailable,
        teacherMaxPeriodsPerDay: cfg.maxPerDay,
      } satisfies GenerateInput;
    });
}

describe('timetable generator properties (G-917)', () => {
  it('produced assignments have 0 hard clashes (≥50 randomised instances)', () => {
    fc.assert(
      fc.property(inputArb(), (input) => {
        const result = generateTimetable(input);
        expect(result.hardClashCount).toBe(0);
        expect(countHardClashes(result.assignments, input)).toBe(0);
        const assigned = result.assignments.length;
        const leftover = result.unassigned.reduce((s, u) => s + u.remaining, 0);
        expect(assigned + leftover).toBe(result.stats.demandPeriods);
      }),
      { numRuns: 60 },
    );
  });

  it('never double-books a teacher on the same day+period', () => {
    fc.assert(
      fc.property(inputArb(), (input) => {
        const { assignments } = generateTimetable(input);
        const seen = new Set<string>();
        for (const a of assignments) {
          const k = `${a.staffId}|${a.dayOfWeek}|${a.periodId}`;
          expect(seen.has(k)).toBe(false);
          seen.add(k);
        }
      }),
      { numRuns: 50 },
    );
  });

  it('places every demand when the grid is large enough for a single section', () => {
    const periods: GeneratorPeriod[] = [
      { id: 'p1', periodOrder: 1, startTime: '08:00', endTime: '08:45' },
      { id: 'p2', periodOrder: 2, startTime: '09:00', endTime: '09:45' },
      { id: 'p3', periodOrder: 3, startTime: '10:00', endTime: '10:45' },
    ];
    const rooms: GeneratorRoom[] = [{ id: 'r1', capacity: 40 }];
    const input: GenerateInput = {
      daysOfWeek: [1, 2, 3, 4, 5],
      periods,
      rooms,
      demands: [
        {
          id: 'd1',
          sectionId: 's1',
          subjectId: 'math',
          staffId: 't1',
          periodsPerWeek: 4,
          preferredRoomId: 'r1',
          enrollmentCount: 20,
        },
        {
          id: 'd2',
          sectionId: 's1',
          subjectId: 'eng',
          staffId: 't2',
          periodsPerWeek: 3,
          preferredRoomId: 'r1',
          enrollmentCount: 20,
        },
      ],
      teacherMaxPeriodsPerDay: 6,
    };
    const result = generateTimetable(input);
    expect(result.hardClashCount).toBe(0);
    expect(result.unassigned).toEqual([]);
    expect(result.assignments).toHaveLength(7);
  });

  /**
   * PRC-M550(a): executeGenerationJob previously called generateTimetable without telling it
   * about meetings already committed to the DB for this institution/period, so the generator
   * happily assigned the same slot a real meeting already occupies — the clash was only caught
   * later at persist time (createMeeting throws, persistSkipped increments), silently dropping
   * that demand period instead of placing it elsewhere. existingAssignments seeds the
   * generator's occupancy before the greedy fill loop starts, so canPlaceHard rejects it up
   * front and the demand is placed elsewhere (or lands in unassigned), never double-booked.
   */
  it('never re-assigns a slot seeded via existingAssignments (PRC-M550a)', () => {
    const periods: GeneratorPeriod[] = [
      { id: 'p1', periodOrder: 1, startTime: '08:00', endTime: '08:45' },
    ];
    const rooms: GeneratorRoom[] = [{ id: 'r1', capacity: 40 }];
    const seededAssignment = {
      demandId: 'existing:seed',
      sectionId: 'other-section',
      subjectId: 'other-subject',
      staffId: 't1',
      roomId: null,
      periodId: 'p1',
      dayOfWeek: 1,
    };
    const input: GenerateInput = {
      daysOfWeek: [1],
      periods,
      rooms,
      demands: [
        {
          id: 'd1',
          sectionId: 's1',
          subjectId: 'math',
          staffId: 't1',
          periodsPerWeek: 1,
        },
      ],
      existingAssignments: [seededAssignment],
    };
    const result = generateTimetable(input);
    expect(result.hardClashCount).toBe(0);
    // The only slot (day 1, p1) is taken by the seeded assignment; d1 cannot be placed there,
    // so it must be left unassigned rather than double-booking staffId t1's existing meeting.
    expect(result.assignments).toHaveLength(0);
    expect(result.unassigned).toEqual([{ demandId: 'd1', remaining: 1 }]);
  });

  /**
   * PRC-L374 part 1: teacherMaxPeriodsPerDay was scoring-only (softScore penalizes exceeding
   * it, but the repair loop's displace-and-retry cycle could still leave the output over the
   * cap after MAX_REPAIR_PASSES). canPlaceHard now rejects placing a teacher beyond the cap on
   * any single day, so the excess always lands in unassigned instead. This is a hard-constraint
   * finding, so failing-first proof is required: on the pre-fix code, with periodsPerWeek(5) >
   * teacherMaxPeriodsPerDay(2) and only one day's worth of slots offered, some day in the output
   * can exceed the cap.
   */
  it('never places more than teacherMaxPeriodsPerDay periods for one staff on one day', () => {
    const periods: GeneratorPeriod[] = [
      { id: 'p1', periodOrder: 1, startTime: '08:00', endTime: '08:45' },
      { id: 'p2', periodOrder: 2, startTime: '09:00', endTime: '09:45' },
      { id: 'p3', periodOrder: 3, startTime: '10:00', endTime: '10:45' },
      { id: 'p4', periodOrder: 4, startTime: '11:00', endTime: '11:45' },
      { id: 'p5', periodOrder: 5, startTime: '12:00', endTime: '12:45' },
    ];
    const input: GenerateInput = {
      daysOfWeek: [1],
      periods,
      rooms: [],
      demands: [
        {
          id: 'd1',
          sectionId: 's1',
          subjectId: 'math',
          staffId: 't1',
          periodsPerWeek: 5,
        },
      ],
      teacherMaxPeriodsPerDay: 2,
    };
    const result = generateTimetable(input);
    expect(result.hardClashCount).toBe(0);
    const byDay = new Map<number, number>();
    for (const a of result.assignments) {
      byDay.set(a.dayOfWeek, (byDay.get(a.dayOfWeek) ?? 0) + 1);
    }
    for (const count of byDay.values()) {
      expect(count).toBeLessThanOrEqual(2);
    }
    const leftover = result.unassigned.reduce((s, u) => s + u.remaining, 0);
    expect(result.assignments.length + leftover).toBe(5);
    expect(leftover).toBeGreaterThan(0);
  });
});
