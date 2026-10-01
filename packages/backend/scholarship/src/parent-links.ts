/**
 * Guardian authority for scholarship documents. Reads parent_child_links
 * inside the caller's tenant (RLS). Returns [] when the table is absent.
 */
import { AppError } from '@proctira/common';
import { withPgTenant } from '@proctira/database';

import { getSharedScholarshipPool } from './pg-scholarship-repository.js';

export async function linkedStudentIdsForParent(
  tenantId: string,
  parentUserId: string,
): Promise<string[]> {
  const pool = getSharedScholarshipPool();
  if (!pool || !parentUserId) return [];
  return withPgTenant(pool, tenantId, async (client) => {
    const result = await client.query(
      `SELECT student_id::text AS student_id
         FROM parent_child_links
        WHERE parent_user_id = $1
          AND status = 'active'`,
      [parentUserId],
    );
    return result.rows.map((row) => String((row as { student_id: string }).student_id));
  });
}

/** Current enrolment institution for a linked student, or null when unknown. */
export async function institutionIdForStudent(
  tenantId: string,
  studentId: string,
): Promise<string | null> {
  const pool = getSharedScholarshipPool();
  if (!pool || !studentId) return null;
  try {
    return await withPgTenant(pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT institution_id::text AS institution_id
           FROM enrollments
          WHERE student_id = $1
          ORDER BY enrolled_at DESC NULLS LAST
          LIMIT 1`,
        [studentId],
      );
      const row = result.rows[0] as { institution_id?: unknown } | undefined;
      const id = row?.institution_id;
      return typeof id === 'string' ? id : null;
    });
  } catch (error) {
    // PRC-L346: an outage is not "unknown institution"; surface it as 503.
    throw linkLookupUnavailable('Student enrolment lookup is unavailable', error);
  }
}

/**
 * PRC-L346: guardian-link / enrolment lookups that fail are an outage, not an
 * empty result. Callers surface this as 503 so parents can tell the difference.
 */
export function linkLookupUnavailable(message: string, cause: unknown): AppError {
  const error = new AppError(message, 'SERVICE_UNAVAILABLE', 503);
  (error as AppError & { cause?: unknown }).cause = cause;
  return error;
}
