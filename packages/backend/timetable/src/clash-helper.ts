/**
 * Pure clash detection for timetable / substitutions (no I/O).
 *
 * Teacher double-book: same tenant staff cannot occupy two meetings that share
 * dayOfWeek and overlapping period times (and, for substitutions, the same calendar date).
 */

import { intervalsOverlap } from './clash-detection.js';

export type ClashReason = 'staff' | 'class' | 'room' | 'substitute';

export interface ClashConflict {
  reason: ClashReason;
  meetingId?: string;
  substitutionId?: string;
  dayOfWeek: number;
  periodId: string;
  staffId?: string;
  sectionId?: string;
  roomId?: string | null;
  date?: string;
}

export interface MeetingSlotLike {
  id: string;
  staffId: string;
  sectionId: string;
  periodId: string;
  dayOfWeek: number;
  roomId?: string | null;
  status?: string;
}

export interface SubstitutionSlotLike {
  id: string;
  substituteStaffId: string;
  periodId: string;
  dayOfWeek: number;
  substitutionDate: string;
  status?: string;
}

function isActive(status?: string): boolean {
  if (!status) return true;
  const s = status.toLowerCase();
  return s !== 'cancelled' && s !== 'inactive' && s !== 'deleted';
}

/** Period wall-clock window ("HH:MM" or "HH:MM:SS"). */
export interface PeriodWindow {
  startTime: string;
  endTime: string;
}

/**
 * PRC-M398: two slots on the same weekday collide when their periods overlap in time —
 * even if they belong to different bell schedules (different period ids). When either
 * period's times are unknown we fall back to period-id equality.
 */
function periodsCollide(
  a: string,
  b: string,
  periodTimes?: ReadonlyMap<string, PeriodWindow>,
): boolean {
  if (a === b) return true;
  const pa = periodTimes?.get(a);
  const pb = periodTimes?.get(b);
  if (!pa || !pb) return false;
  try {
    return intervalsOverlap(pa.startTime, pa.endTime, pb.startTime, pb.endTime);
  } catch {
    return false;
  }
}

/**
 * Detect teacher / section / room double-books among meeting slots.
 */
export function detectMeetingClashes(
  existing: MeetingSlotLike[],
  candidate: Omit<MeetingSlotLike, 'id'> & { id?: string },
  excludeMeetingId?: string,
  periodTimes?: ReadonlyMap<string, PeriodWindow>,
): ClashConflict[] {
  const conflicts: ClashConflict[] = [];

  for (const slot of existing) {
    if (excludeMeetingId && slot.id === excludeMeetingId) continue;
    if (candidate.id && slot.id === candidate.id) continue;
    if (!isActive(slot.status)) continue;
    if (slot.dayOfWeek !== candidate.dayOfWeek) continue;
    if (!periodsCollide(slot.periodId, candidate.periodId, periodTimes)) continue;

    if (slot.staffId === candidate.staffId) {
      conflicts.push({
        reason: 'staff',
        meetingId: slot.id,
        dayOfWeek: slot.dayOfWeek,
        periodId: slot.periodId,
        staffId: slot.staffId,
        sectionId: slot.sectionId,
      });
    }
    if (slot.sectionId === candidate.sectionId) {
      conflicts.push({
        reason: 'class',
        meetingId: slot.id,
        dayOfWeek: slot.dayOfWeek,
        periodId: slot.periodId,
        sectionId: slot.sectionId,
      });
    }
    if (
      candidate.roomId != null &&
      candidate.roomId !== '' &&
      slot.roomId != null &&
      slot.roomId === candidate.roomId
    ) {
      conflicts.push({
        reason: 'room',
        meetingId: slot.id,
        dayOfWeek: slot.dayOfWeek,
        periodId: slot.periodId,
        roomId: slot.roomId,
      });
    }
  }

  return conflicts;
}

/**
 * Detect substitute teacher double-book against meetings + other substitutions
 * that share the same weekday + period on the same date.
 */
export function detectSubstituteClashes(input: {
  substituteStaffId: string;
  periodId: string;
  dayOfWeek: number;
  substitutionDate: string;
  meetings: MeetingSlotLike[];
  substitutions: SubstitutionSlotLike[];
  excludeSubstitutionId?: string;
  periodTimes?: ReadonlyMap<string, PeriodWindow>;
}): ClashConflict[] {
  const conflicts: ClashConflict[] = [];
  const { substituteStaffId, periodId, dayOfWeek, substitutionDate } = input;

  for (const meeting of input.meetings) {
    if (!isActive(meeting.status)) continue;
    if (meeting.staffId !== substituteStaffId) continue;
    if (meeting.dayOfWeek !== dayOfWeek) continue;
    if (!periodsCollide(meeting.periodId, periodId, input.periodTimes)) continue;
    conflicts.push({
      reason: 'substitute',
      meetingId: meeting.id,
      dayOfWeek,
      periodId,
      staffId: substituteStaffId,
      sectionId: meeting.sectionId,
      date: substitutionDate,
    });
  }

  for (const sub of input.substitutions) {
    if (input.excludeSubstitutionId && sub.id === input.excludeSubstitutionId) continue;
    if (!isActive(sub.status)) continue;
    if (sub.substituteStaffId !== substituteStaffId) continue;
    if (sub.substitutionDate !== substitutionDate) continue;
    if (sub.dayOfWeek !== dayOfWeek) continue;
    if (!periodsCollide(sub.periodId, periodId, input.periodTimes)) continue;
    conflicts.push({
      reason: 'substitute',
      substitutionId: sub.id,
      dayOfWeek,
      periodId,
      staffId: substituteStaffId,
      date: substitutionDate,
    });
  }

  return conflicts;
}
