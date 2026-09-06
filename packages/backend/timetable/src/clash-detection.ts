/**
 * Pure domain clash detection for timetable / master schedule (WS1 + WS2).
 * No I/O — used by unit tests and the API conflict engine.
 */

export type MeetingSlot = {
  id: string;
  dayOfWeek: number; // 1=Mon … 7=Sun
  startTime: string; // HH:MM or HH:MM:SS
  endTime: string;
  teacherId?: string | null;
  roomId?: string | null;
  /** Optional enrolled student ids for overload policy checks. */
  studentIds?: string[];
};

export type ClashKind =
  | 'TEACHER_DOUBLE_BOOK'
  | 'ROOM_DOUBLE_BOOK'
  | 'INVALID_PERIOD'
  | 'STUDENT_OVERLOAD';

export type Clash = {
  kind: ClashKind;
  meetingIds: string[];
  resourceId?: string;
  message: string;
};

/** Parse "HH:MM" / "HH:MM:SS" to minutes from midnight. */
export function timeToMinutes(value: string): number {
  const parts = value.split(':').map((p) => Number(p));
  if (parts.length < 2 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`Invalid time: ${value}`);
  }
  const [h = 0, m = 0, s = 0] = parts;
  return h * 60 + m + s / 60;
}

export function intervalsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  const as = timeToMinutes(aStart);
  const ae = timeToMinutes(aEnd);
  const bs = timeToMinutes(bStart);
  const be = timeToMinutes(bEnd);
  return as < be && bs < ae;
}

function isValidPeriod(slot: MeetingSlot): string | null {
  if (slot.dayOfWeek < 1 || slot.dayOfWeek > 7) {
    return 'dayOfWeek must be 1–7';
  }
  try {
    const start = timeToMinutes(slot.startTime);
    const end = timeToMinutes(slot.endTime);
    if (!(start < end)) return 'startTime must be before endTime';
  } catch (err) {
    return err instanceof Error ? err.message : 'invalid time';
  }
  return null;
}

/**
 * Detect teacher double-book, room double-book, and invalid period slots.
 * Same-day overlapping intervals on the same resource produce a clash.
 */
export function detectClashes(meetings: MeetingSlot[]): Clash[] {
  const clashes: Clash[] = [];

  for (const m of meetings) {
    const invalid = isValidPeriod(m);
    if (invalid) {
      clashes.push({
        kind: 'INVALID_PERIOD',
        meetingIds: [m.id],
        message: invalid,
      });
    }
  }

  const valid = meetings.filter((m) => isValidPeriod(m) === null);

  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const a = valid[i]!;
      const b = valid[j]!;
      if (a.dayOfWeek !== b.dayOfWeek) continue;
      if (!intervalsOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) continue;

      if (a.teacherId && b.teacherId && a.teacherId === b.teacherId) {
        clashes.push({
          kind: 'TEACHER_DOUBLE_BOOK',
          meetingIds: [a.id, b.id],
          resourceId: a.teacherId,
          message: `Teacher ${a.teacherId} double-booked on day ${a.dayOfWeek}`,
        });
      }

      if (a.roomId && b.roomId && a.roomId === b.roomId) {
        clashes.push({
          kind: 'ROOM_DOUBLE_BOOK',
          meetingIds: [a.id, b.id],
          resourceId: a.roomId,
          message: `Room ${a.roomId} double-booked on day ${a.dayOfWeek}`,
        });
      }

      const sharedStudents = intersectStudents(a.studentIds, b.studentIds);
      for (const studentId of sharedStudents) {
        clashes.push({
          kind: 'STUDENT_OVERLOAD',
          meetingIds: [a.id, b.id],
          resourceId: studentId,
          message: `Student ${studentId} double-booked on day ${a.dayOfWeek}`,
        });
      }
    }
  }

  return clashes;
}

function intersectStudents(
  a?: string[],
  b?: string[],
): string[] {
  if (!a?.length || !b?.length) return [];
  const setB = new Set(b);
  return a.filter((id) => setB.has(id));
}

export function hasClashes(meetings: MeetingSlot[]): boolean {
  return detectClashes(meetings).length > 0;
}

/**
 * Room ∩ time and teacher ∩ time only (WS2 publish gate helper).
 * Ignores student overload unless callers attach studentIds.
 */
export function detectRoomAndTeacherClashes(meetings: MeetingSlot[]): Clash[] {
  return detectClashes(meetings).filter(
    (c) => c.kind === 'ROOM_DOUBLE_BOOK' || c.kind === 'TEACHER_DOUBLE_BOOK',
  );
}
