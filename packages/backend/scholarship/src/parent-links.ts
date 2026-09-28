/**
 * Guardian authority for scholarship documents. Reads parent_child_links
 * inside the caller's tenant (RLS). Returns [] when the table is absent.
 */
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
      const id = result.rows[0]?.institution_id;
      return typeof id === 'string' ? id : null;
    });
  } catch {
    return null;
  }
}
