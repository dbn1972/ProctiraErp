import { describe, expect, it } from 'vitest';

import {
  detectClashes,
  detectRoomAndTeacherClashes,
  hasClashes,
  intervalsOverlap,
  timeToMinutes,
  type MeetingSlot,
} from './clash-detection.js';

describe('timeToMinutes', () => {
  it('parses HH:MM', () => {
    expect(timeToMinutes('09:30')).toBe(9 * 60 + 30);
  });
});

describe('intervalsOverlap', () => {
  it('detects overlap and adjacency', () => {
    expect(intervalsOverlap('09:00', '10:00', '09:30', '10:30')).toBe(true);
    expect(intervalsOverlap('09:00', '10:00', '10:00', '11:00')).toBe(false);
    expect(intervalsOverlap('09:00', '10:00', '08:00', '08:30')).toBe(false);
  });
});

describe('detectClashes', () => {
  const base: MeetingSlot[] = [
    {
      id: 'm1',
      dayOfWeek: 1,
      startTime: '09:00',
      endTime: '09:45',
      teacherId: 't1',
      roomId: 'r1',
    },
    {
      id: 'm2',
      dayOfWeek: 1,
      startTime: '09:30',
      endTime: '10:15',
      teacherId: 't1',
      roomId: 'r2',
    },
  ];

  it('flags teacher double-book on overlapping slots', () => {
    const clashes = detectClashes(base);
    expect(clashes.some((c) => c.kind === 'TEACHER_DOUBLE_BOOK')).toBe(true);
    expect(hasClashes(base)).toBe(true);
  });

  it('flags room double-book', () => {
    const meetings: MeetingSlot[] = [
      { ...base[0]!, teacherId: 't1', roomId: 'r1' },
      { ...base[1]!, id: 'm2', teacherId: 't2', roomId: 'r1' },
    ];
    const clashes = detectClashes(meetings);
    expect(clashes.some((c) => c.kind === 'ROOM_DOUBLE_BOOK')).toBe(true);
  });

  it('allows same teacher on different days', () => {
    const meetings: MeetingSlot[] = [
      { ...base[0]! },
      { ...base[1]!, id: 'm2', dayOfWeek: 2, teacherId: 't1', roomId: 'r1' },
    ];
    expect(detectClashes(meetings)).toEqual([]);
  });

  it('flags invalid period windows', () => {
    const clashes = detectClashes([
      {
        id: 'bad',
        dayOfWeek: 1,
        startTime: '10:00',
        endTime: '09:00',
        teacherId: 't1',
      },
    ]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0]!.kind).toBe('INVALID_PERIOD');
  });

  it('flags student overload on overlapping enrolled slots', () => {
    const meetings: MeetingSlot[] = [
      { ...base[0]!, teacherId: 't1', roomId: 'r1', studentIds: ['s1', 's2'] },
      {
        ...base[1]!,
        id: 'm2',
        teacherId: 't2',
        roomId: 'r2',
        studentIds: ['s2', 's3'],
      },
    ];
    const clashes = detectClashes(meetings);
    expect(clashes.some((c) => c.kind === 'STUDENT_OVERLOAD' && c.resourceId === 's2')).toBe(true);
  });

  it('detectRoomAndTeacherClashes omits student overload', () => {
    const meetings: MeetingSlot[] = [
      { ...base[0]!, teacherId: 't1', roomId: 'r1', studentIds: ['s1'] },
      {
        ...base[1]!,
        id: 'm2',
        teacherId: 't2',
        roomId: 'r1',
        studentIds: ['s1'],
      },
    ];
    const clashes = detectRoomAndTeacherClashes(meetings);
    expect(clashes.every((c) => c.kind === 'ROOM_DOUBLE_BOOK')).toBe(true);
  });
});
