/**
 * Resolve authoritative institution assignments for a health actor (W1-SEC-04).
 *
 * Prefers `staff_assignments` linked via `staff.custom_data.userId` (or
 * `user_id`). When the lookup has not been attempted at all (no pool / no
 * userId), returns `null` so callers fall back to JWT claims — still subject
 * to deny-on-missing-scope.
 *
 * PRC-L312: a query failure (RLS, schema drift, connection error) is NOT the
 * same as "not attempted" and must re-throw rather than silently return
 * `null` — a caller that treated a thrown lookup as "not attempted" would
 * fall back to JWT institution claims, which can grant a school-bound actor
 * access outside their real assignment. The caller (health-service.ts's
 * resolveAuthoritativeInstitutions) is responsible for failing closed on this
 * error.
 */
import { withPgTenant } from '@proctira/database';

import type { PgPoolLike } from './pg-counselling-store.js';

export async function findActorInstitutionAssignments(
  pool: PgPoolLike | null | undefined,
  tenantId: string,
  userId: string,
): Promise<string[] | null> {
  if (!pool || !userId?.trim()) return null;
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
}
