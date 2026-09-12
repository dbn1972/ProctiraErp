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

/**
 * Optimistic concurrency failure (stale If-Match / expectedUpdatedAt).
 * HTTP 409 — distinct from TIMETABLE_CLASH (room/teacher double-book).
 */
export class TimetableVersionConflictError extends Error {
  readonly code = 'VERSION_CONFLICT' as const;
  readonly statusCode = 409;
  readonly entityType: string;
  readonly entityId: string;
  readonly currentVersion: string;

  constructor(entityType: string, entityId: string, currentVersion: string) {
    super(
      `VERSION_CONFLICT: ${entityType} ${entityId} was modified; refresh and retry (current=${currentVersion})`,
    );
    this.name = 'TimetableVersionConflictError';
    this.entityType = entityType;
    this.entityId = entityId;
    this.currentVersion = currentVersion;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message.replace(/^VERSION_CONFLICT:\s*/, ''),
      statusCode: this.statusCode,
      entityType: this.entityType,
      entityId: this.entityId,
      currentVersion: this.currentVersion,
    };
  }
}

export function isTimetableVersionConflictError(
  error: unknown,
): error is TimetableVersionConflictError {
  return (
    error instanceof TimetableVersionConflictError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'VERSION_CONFLICT')
  );
}

/** Normalize If-Match / ETag token (strip weak tags and surrounding quotes). */
export function normalizeIfMatchToken(raw: string | undefined | null): string | undefined {
  if (raw == null) return undefined;
  const trimmed = String(raw).trim();
  if (!trimmed) return undefined;
  const withoutWeak = trimmed.replace(/^W\//i, '').trim();
  if (
    (withoutWeak.startsWith('"') && withoutWeak.endsWith('"')) ||
    (withoutWeak.startsWith("'") && withoutWeak.endsWith("'"))
  ) {
    return withoutWeak.slice(1, -1);
  }
  return withoutWeak;
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
