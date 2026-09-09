/**
 * Pure clash helpers for examination ops (G-908).
 *
 * A staff member cannot invigilate two sessions that overlap in time;
 * a room cannot host two overlapping sessions.
 */

export interface TimedSlot {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  roomId: string;
}

export interface InvigilatorAssignment {
  sessionId: string;
  staffId: string;
}

export type ClashKind = 'staff_overlap' | 'room_overlap';

export interface AllocationConflict {
  kind: ClashKind;
  sessionId: string;
  otherSessionId: string;
  staffId?: string;
  roomId?: string;
  message: string;
}

/** Normalise HH:MM or HH:MM:SS to HH:MM for lexicographic compare. */
export function normalizeClock(value: string): string {
  const parts = value.trim().split(':');
  const hh = (parts[0] ?? '00').padStart(2, '0');
  const mm = (parts[1] ?? '00').padStart(2, '0').slice(0, 2);
  return `${hh}:${mm}`;
}

export function sessionsOverlap(a: TimedSlot, b: TimedSlot): boolean {
  if (a.date !== b.date) return false;
  const aStart = normalizeClock(a.startTime);
  const aEnd = normalizeClock(a.endTime);
  const bStart = normalizeClock(b.startTime);
  const bEnd = normalizeClock(b.endTime);
  return aStart < bEnd && bStart < aEnd;
}

export function findRoomClashes(candidate: TimedSlot, existing: TimedSlot[]): AllocationConflict[] {
  return existing
    .filter((other) => other.id !== candidate.id && other.roomId === candidate.roomId)
    .filter((other) => sessionsOverlap(candidate, other))
    .map((other) => ({
      kind: 'room_overlap' as const,
      sessionId: candidate.id,
      otherSessionId: other.id,
      roomId: candidate.roomId,
      message: `Room '${candidate.roomId}' is already booked for an overlapping session`,
    }));
}

export function findStaffClashes(
  session: TimedSlot,
  staffId: string,
  sessionsById: Map<string, TimedSlot>,
  assignments: InvigilatorAssignment[],
): AllocationConflict[] {
  const conflicts: AllocationConflict[] = [];
  for (const assignment of assignments) {
    if (assignment.staffId !== staffId) continue;
    if (assignment.sessionId === session.id) continue;
    const other = sessionsById.get(assignment.sessionId);
    if (!other) continue;
    if (!sessionsOverlap(session, other)) continue;
    conflicts.push({
      kind: 'staff_overlap',
      sessionId: session.id,
      otherSessionId: other.id,
      staffId,
      message: `Staff '${staffId}' is already allocated to an overlapping session`,
    });
  }
  return conflicts;
}

/** True iff no staff member appears on two overlapping sessions. */
export function invigilatorsAreClashFree(
  sessions: TimedSlot[],
  assignments: InvigilatorAssignment[],
): boolean {
  const sessionsById = new Map(sessions.map((s) => [s.id, s] as const));
  const byStaff = new Map<string, string[]>();
  for (const assignment of assignments) {
    const list = byStaff.get(assignment.staffId) ?? [];
    list.push(assignment.sessionId);
    byStaff.set(assignment.staffId, list);
  }
  for (const sessionIds of byStaff.values()) {
    for (let i = 0; i < sessionIds.length; i += 1) {
      const a = sessionsById.get(sessionIds[i]!);
      if (!a) continue;
      for (let j = i + 1; j < sessionIds.length; j += 1) {
        const b = sessionsById.get(sessionIds[j]!);
        if (b && sessionsOverlap(a, b)) {
          return false;
        }
      }
    }
  }
  return true;
}
