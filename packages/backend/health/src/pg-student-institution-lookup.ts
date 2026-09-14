/**
 * Resolve a student's active enrollment institution for PHI scope + authZ.
 */
import { withPgTenant } from '@proctira/database';

import type { PgPoolLike } from './pg-counselling-store.js';

export async function findStudentInstitutionId(
  pool: PgPoolLike | null | undefined,
  tenantId: string,
  studentId: string,
): Promise<string | null> {
  if (!pool) return null;
  try {
    const result = await withPgTenant(pool, tenantId, async (client) =>
      client.query<{ institution_id: string }>(
        `SELECT institution_id::text AS institution_id
         FROM enrollments
         WHERE tenant_id = $1::uuid
           AND student_id = $2::uuid
           AND status = 'ENROLLED'
           AND exited_at IS NULL
         ORDER BY enrolled_at DESC
         LIMIT 1`,
        [tenantId, studentId],
      ),
    );
    const row = result.rows[0];
    return row?.institution_id ? String(row.institution_id) : null;
  } catch {
    return null;
  }
}
