/** Domain errors for gradebook / transcripts (WS3). */

export class GradebookSchemaMissingError extends Error {
  readonly code = 'GRADEBOOK_SCHEMA_MISSING' as const;
  readonly statusCode = 503;

  constructor(
    message = 'Gradebook tables are not applied. Run db/sql/003_sis_timetable_schedule_schema.sql',
  ) {
    super(message);
    this.name = 'GradebookSchemaMissingError';
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

export function isGradebookSchemaMissingError(
  error: unknown,
): error is GradebookSchemaMissingError {
  return (
    error instanceof GradebookSchemaMissingError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'GRADEBOOK_SCHEMA_MISSING')
  );
}

export class TranscriptImmutableError extends Error {
  readonly code = 'TRANSCRIPT_IMMUTABLE' as const;
  readonly statusCode = 409;

  constructor(message = 'Issued transcripts are immutable; issue a new version instead') {
    super(message);
    this.name = 'TranscriptImmutableError';
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

export function isTranscriptImmutableError(
  error: unknown,
): error is TranscriptImmutableError {
  return (
    error instanceof TranscriptImmutableError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'TRANSCRIPT_IMMUTABLE')
  );
}

export class GradeLockedError extends Error {
  readonly code = 'GRADE_LOCKED' as const;
  readonly statusCode = 409;

  constructor(message = 'Grade entry is locked and cannot be modified') {
    super(message);
    this.name = 'GradeLockedError';
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

export function isGradeLockedError(error: unknown): error is GradeLockedError {
  return (
    error instanceof GradeLockedError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'GRADE_LOCKED')
  );
}
