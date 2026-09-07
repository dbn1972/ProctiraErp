/** Domain error for timetable clashes (teacher / section / room / substitute). */

import type { ClashConflict } from './clash-helper.js';

export class TimetableClashError extends Error {
  readonly code = 'TIMETABLE_CLASH' as const;
  readonly statusCode = 409;
  readonly conflicts: ClashConflict[];

  constructor(message: string, conflicts: ClashConflict[]) {
    super(`TIMETABLE_CLASH: ${message}`);
    this.name = 'TimetableClashError';
    this.conflicts = conflicts;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message.replace(/^TIMETABLE_CLASH:\s*/, ''),
      statusCode: this.statusCode,
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

/** Thrown when planned SQL tables are not applied yet. */
export class TimetableSchemaMissingError extends Error {
  readonly code = 'TIMETABLE_SCHEMA_MISSING' as const;
  readonly statusCode = 503;

  constructor(
    message = 'Timetable tables are not applied. Run db/sql/003_sis_timetable_schedule_schema.sql',
  ) {
    super(message);
    this.name = 'TimetableSchemaMissingError';
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
    };
  }
}

export function isTimetableSchemaMissingError(
  error: unknown,
): error is TimetableSchemaMissingError {
  return (
    error instanceof TimetableSchemaMissingError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'TIMETABLE_SCHEMA_MISSING')
  );
}
