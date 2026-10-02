/**
 * PRC-L365: admission-number helpers shared by repositories and the service.
 */
import { ConflictError } from '@proctira/common';

export const ADMISSION_NUMBER_CONFLICT = 'Student with this admission number already exists';

/** Admission number carried in customData (`admissionNo` preferred, legacy `admissionNumber`). */
export function admissionNoOf(
  customData: Record<string, unknown> | undefined | null,
): string | null {
  const a = customData?.['admissionNo'];
  if (typeof a === 'string' && a.trim()) return a.trim();
  const b = customData?.['admissionNumber'];
  if (typeof b === 'string' && b.trim()) return b.trim();
  return null;
}

/** True for Prisma P2002, Prisma P2010 wrapping pg 23505 (raw SQL), or raw pg 23505. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string } } | null;
  return (
    e?.code === '23505' || e?.code === 'P2002' || (e?.code === 'P2010' && e.meta?.code === '23505')
  );
}

/** Rethrow a unique violation as 409 ConflictError; other errors unchanged. */
export function rethrowUniqueViolation(err: unknown, message: string): never {
  if (isUniqueViolation(err)) throw new ConflictError(message);
  throw err;
}
