import { describe, expect, it } from 'vitest';

import {
  detectMeetingClashes,
  detectSubstituteClashes,
  type MeetingSlotLike,
} from './clash-helper.js';

const periodA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const periodB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const staffA = 'staff-a';
const staffB = 'staff-b';
const section1 = 'section-1';
const section2 = 'section-2';
const room1 = 'room-1';

function meeting(overrides: Partial<MeetingSlotLike> & { id: string }): MeetingSlotLike {
  return {
    staffId: staffA,
    sectionId: section1,
    periodId: periodA,
    dayOfWeek: 1,
    roomId: null,
    status: 'active',
    ...overrides,
  };
}

describe('detectMeetingClashes', () => {
  it('flags teacher double-book on same day + period', () => {
    const existing = [meeting({ id: 'm1', staffId: staffA, sectionId: section1 })];
    const conflicts = detectMeetingClashes(existing, {
      staffId: staffA,
      sectionId: section2,
      periodId: periodA,
      dayOfWeek: 1,
      roomId: null,
    });
    expect(conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'staff', staffId: staffA, meetingId: 'm1' }),
      ]),
    );
  });

  it('allows same teacher on a different period', () => {
    const existing = [meeting({ id: 'm1', periodId: periodA })];
    const conflicts = detectMeetingClashes(existing, {
      staffId: staffA,
      sectionId: section2,
      periodId: periodB,
      dayOfWeek: 1,
      roomId: null,
    });
    expect(conflicts).toHaveLength(0);
  });

  it('flags section clash and room clash independently', () => {
    const existing = [
      meeting({ id: 'm1', staffId: staffA, sectionId: section1, roomId: room1 }),
    ];
    const conflicts = detectMeetingClashes(existing, {
      staffId: staffB,
      sectionId: section1,
      periodId: periodA,
      dayOfWeek: 1,
      roomId: room1,
    });
    expect(conflicts.map((c) => c.reason).sort()).toEqual(['class', 'room']);
  });

  it('ignores inactive meetings and excluded ids', () => {
    const existing = [
      meeting({ id: 'm1', status: 'cancelled' }),
      meeting({ id: 'm2', staffId: staffA }),
    ];
    expect(
      detectMeetingClashes(
        existing,
        {
          staffId: staffA,
          sectionId: section2,
          periodId: periodA,
          dayOfWeek: 1,
        },
        'm2',
      ),
    ).toHaveLength(0);
  });
});

describe('detectSubstituteClashes', () => {
  it('flags substitute already teaching that period', () => {
    const conflicts = detectSubstituteClashes({
      substituteStaffId: staffB,
      periodId: periodA,
      dayOfWeek: 2,
      substitutionDate: '2026-09-08',
      meetings: [meeting({ id: 'm1', staffId: staffB, dayOfWeek: 2 })],
      substitutions: [],
    });
    expect(conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'substitute', staffId: staffB, meetingId: 'm1' }),
      ]),
    );
  });

  it('flags overlapping substitute assignment on same date', () => {
    const conflicts = detectSubstituteClashes({
      substituteStaffId: staffB,
      periodId: periodA,
      dayOfWeek: 3,
      substitutionDate: '2026-09-09',
      meetings: [],
      substitutions: [
        {
          id: 's1',
          substituteStaffId: staffB,
          periodId: periodA,
          dayOfWeek: 3,
          substitutionDate: '2026-09-09',
          status: 'scheduled',
        },
      ],
    });
    expect(conflicts[0]).toMatchObject({
      reason: 'substitute',
      substitutionId: 's1',
      date: '2026-09-09',
    });
  });
});
