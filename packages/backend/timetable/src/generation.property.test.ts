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
import { describe, expect, it } from 'vitest';

import {
  countHardClashes,
  generateTimetable,
  type GenerateInput,
  type GeneratorDemand,
  type GeneratorPeriod,
  type GeneratorRoom,
} from './generation.js';

function uuid(): string {
  return randomUUID();
}

const periodArb: fc.Arbitrary<GeneratorPeriod[]> = fc
  .integer({ min: 3, max: 6 })
  .map((n) =>
    Array.from({ length: n }, (_, i) => ({
      id: `p-${i + 1}`,
      periodOrder: i + 1,
      startTime: `${String(8 + i).padStart(2, '0')}:00`,
      endTime: `${String(8 + i).padStart(2, '0')}:45`,
    })),
  );

const roomArb: fc.Arbitrary<GeneratorRoom[]> = fc
  .integer({ min: 2, max: 5 })
  .map((n) =>
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
});
