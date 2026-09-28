import type { ScheduleConflict } from '@/lib/api/timetable';

const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const REASONS: Record<string, string> = {
  staff: 'Teacher clash',
  room: 'Room clash',
  class: 'Class clash',
  substitute: 'Substitute clash',
};

export function dayLabel(dayOfWeek: number): string {
  return DAYS[dayOfWeek] ?? `Day ${dayOfWeek}`;
}

export function conflictReasonLabel(reason: string): string {
  return REASONS[reason] ?? reason;
}

export function formatScheduleConflict(
  conflict: ScheduleConflict,
  labels: {
    staff: Map<string, string>;
    room: Map<string, string>;
    period: Map<string, string>;
    section: Map<string, string>;
  },
): string {
  const who = conflict.staffId
    ? (labels.staff.get(conflict.staffId) ?? 'A teacher')
    : conflict.roomId
      ? (labels.room.get(conflict.roomId) ?? 'A room')
      : conflict.sectionId
        ? (labels.section.get(conflict.sectionId) ?? 'A section')
        : 'A class';
  const when = `${dayLabel(conflict.dayOfWeek)} · ${labels.period.get(conflict.periodId) ?? 'a period'}`;
  return `${who} is double-booked on ${when}.`;
}
