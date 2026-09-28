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
