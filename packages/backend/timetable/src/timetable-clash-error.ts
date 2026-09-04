/** Domain error for timetable slot clashes (staff / class / room). */

export type TimetableClashReason = 'staff' | 'class' | 'room';

export interface TimetableClashConflict {
  slotId: string;
  reason: TimetableClashReason;
  dayOfWeek: number;
  bellPeriodId: string;
  staffId?: string;
  classId?: string;
  roomId?: string | null;
}

export class TimetableClashError extends Error {
  readonly code = 'TIMETABLE_CLASH' as const;
  readonly conflicts: TimetableClashConflict[];

  constructor(message: string, conflicts: TimetableClashConflict[]) {
    super(`TIMETABLE_CLASH: ${message}`);
    this.name = 'TimetableClashError';
    this.conflicts = conflicts;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message.replace(/^TIMETABLE_CLASH:\s*/, ''),
      conflicts: this.conflicts,
    };
  }
}

export function isTimetableClashError(error: unknown): error is TimetableClashError {
  return (
    error instanceof TimetableClashError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'TIMETABLE_CLASH')
  );
}
