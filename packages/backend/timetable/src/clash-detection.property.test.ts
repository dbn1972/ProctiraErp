/**
 * Property tests for the master-schedule conflict engine (G-304).
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import { detectClashes, intervalsOverlap, type MeetingSlot } from './clash-detection.js';
import { detectMeetingClashes, type MeetingSlotLike } from './clash-helper.js';

const timeArb = fc
  .tuple(fc.integer({ min: 0, max: 22 }), fc.integer({ min: 0, max: 59 }))
  .map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);

const orderedIntervalArb = fc
  .tuple(timeArb, timeArb)
  .filter(([a, b]) => a < b)
  .map(([startTime, endTime]) => ({ startTime, endTime }));

const meetingSlotArb: fc.Arbitrary<MeetingSlot> = fc
  .record({
    id: fc.uuid(),
    dayOfWeek: fc.integer({ min: 1, max: 7 }),
    startTime: fc.constant('09:00'),
    endTime: fc.constant('10:00'),
    teacherId: fc.option(fc.uuid(), { nil: undefined }),
    roomId: fc.option(fc.uuid(), { nil: undefined }),
    studentIds: fc.option(fc.array(fc.uuid(), { maxLength: 3 }), { nil: undefined }),
  })
  .chain((base) =>
    orderedIntervalArb.map((interval) => ({
      ...base,
      ...interval,
    })),
  );

const periodMeetingArb: fc.Arbitrary<MeetingSlotLike> = fc.record({
  id: fc.uuid(),
  staffId: fc.uuid(),
  sectionId: fc.uuid(),
  periodId: fc.uuid(),
  dayOfWeek: fc.integer({ min: 1, max: 7 }),
  roomId: fc.option(fc.uuid(), { nil: null }),
  status: fc.constantFrom('active', 'cancelled'),
});

describe('clash-detection properties (G-304)', () => {
  it('intervalsOverlap is symmetric for any valid pair', () => {
    fc.assert(
      fc.property(orderedIntervalArb, orderedIntervalArb, (a, b) => {
        expect(intervalsOverlap(a.startTime, a.endTime, b.startTime, b.endTime)).toBe(
          intervalsOverlap(b.startTime, b.endTime, a.startTime, a.endTime),
        );
      }),
      { numRuns: 80 },
    );
  });

  it('identical overlapping teacher slots always produce TEACHER_DOUBLE_BOOK', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.integer({ min: 1, max: 7 }),
        orderedIntervalArb,
        (teacherId, dayOfWeek, interval) => {
          const meetings: MeetingSlot[] = [
            {
              id: 'a',
              dayOfWeek,
              ...interval,
              teacherId,
              roomId: undefined,
            },
            {
              id: 'b',
              dayOfWeek,
              ...interval,
              teacherId,
              roomId: undefined,
            },
          ];
          const clashes = detectClashes(meetings);
          expect(clashes.some((c) => c.kind === 'TEACHER_DOUBLE_BOOK')).toBe(true);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('detectMeetingClashes ignores inactive existing slots; active peers clash on staff', () => {
    fc.assert(
      fc.property(periodMeetingArb, (slot) => {
        const existing: MeetingSlotLike = {
          ...slot,
          id: 'peer',
          sectionId: 'other-section',
        };
        const candidate = {
          ...slot,
          id: 'cand',
          status: 'active' as const,
          sectionId: 'cand-section',
        };
        const conflicts = detectMeetingClashes([existing], candidate);
        if (!existing.status || ['cancelled', 'inactive', 'deleted'].includes(existing.status)) {
          expect(conflicts.filter((c) => c.reason === 'staff')).toHaveLength(0);
        } else {
          expect(conflicts.some((c) => c.reason === 'staff')).toBe(true);
        }
      }),
      { numRuns: 80 },
    );
  });

  it('non-overlapping days never clash on teacher/room in detectClashes', () => {
    fc.assert(
      fc.property(meetingSlotArb, fc.integer({ min: 1, max: 6 }), (slot, offset) => {
        const otherDay = ((slot.dayOfWeek - 1 + offset) % 7) + 1;
        if (otherDay === slot.dayOfWeek) return;
        const meetings: MeetingSlot[] = [
          slot,
          {
            ...slot,
            id: 'other',
            dayOfWeek: otherDay,
          },
        ];
        expect(
          detectClashes(meetings).filter(
            (c) => c.kind === 'TEACHER_DOUBLE_BOOK' || c.kind === 'ROOM_DOUBLE_BOOK',
          ),
        ).toEqual([]);
      }),
      { numRuns: 60 },
    );
  });
});
