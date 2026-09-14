/**
 * Resolve authoritative institution assignments for a health actor (W1-SEC-04).
 *
 * Prefers `staff_assignments` linked via `staff.custom_data.userId` (or
 * `user_id`). When the relation is unavailable, returns `null` so callers
 * fall back to JWT claims — still subject to deny-on-missing-scope.
 */
import { withPgTenant } from '@proctira/database';

import type { PgPoolLike } from './pg-counselling-store.js';

export async function findActorInstitutionAssignments(
  pool: PgPoolLike | null | undefined,
  tenantId: string,
  userId: string,
): Promise<string[] | null> {
  if (!pool || !userId?.trim()) return null;
  try {
    const result = await withPgTenant(pool, tenantId, async (client) =>
      client.query(
        `SELECT DISTINCT sa.institution_id::text AS institution_id
         FROM staff_assignments sa
         INNER JOIN staff s
           ON s.id = sa.staff_id
          AND s.tenant_id = sa.tenant_id
          AND s.deleted_at IS NULL
         WHERE sa.tenant_id = $1::uuid
           AND sa.status = 'ACTIVE'
           AND (sa.end_date IS NULL OR sa.end_date >= CURRENT_DATE)
           AND (
             s.custom_data->>'userId' = $2
             OR s.custom_data->>'user_id' = $2
           )
         ORDER BY institution_id`,
        [tenantId, userId],
      ),
    );
    return result.rows
      .map((r) => String((r as { institution_id?: string }).institution_id ?? ''))
      .filter(Boolean);
  } catch {
    // Relation missing / RLS / schema drift — not authoritative this request.
    return null;
  }
}
