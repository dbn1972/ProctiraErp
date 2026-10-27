/**
 * Domain errors for academic visibility reads (PRC-M316).
 *
 * A Postgres 42703 (undefined_column) on an academic-read query means the expected
 * schema is not applied as this code expects it — it must never be swallowed as an
 * empty, healthy-looking 200. Mirrors GradebookSchemaMissingError's shape exactly
 * (packages/backend/gradebook/src/gradebook-errors.ts).
 */

export class AcademicColumnMissingError extends Error {
  readonly code = 'ACADEMIC_COLUMN_MISSING' as const;
  readonly statusCode = 503;

  constructor(
    message = 'An academic-read query referenced a column that does not exist on this database. Check that the relevant db/sql migration is applied.',
  ) {
    super(message);
    this.name = 'AcademicColumnMissingError';
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

export function isAcademicColumnMissingError(error: unknown): error is AcademicColumnMissingError {
  return (
    error instanceof AcademicColumnMissingError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'ACADEMIC_COLUMN_MISSING')
  );
}
