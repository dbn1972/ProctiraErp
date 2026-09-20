/**
 * Resolves which institutions an authenticated principal may act for, from the
 * staff assignments that are active right now.
 *
 * Why this exists. `apps/api-gateway/src/institution-scope.ts` authorizes on an
 * `institutions[]` claim, but nothing populated it — `keycloak/verify.ts` returned
 * `institutions: []`, so every principal was effectively unscoped. The authoritative
 * data is `staff_assignments`, linked to the principal by `staff.user_id` (added in
 * db/sql/098).
 *
 * Why resolve per request rather than store a list. "Additional charge" — a
 * headmaster also running a second school — is a temporary posting. Baking it into a
 * long-lived token means it keeps working after the charge ends, and revocation
 * becomes a manual step someone forgets. Deriving from assignments active *now*
 * makes the charge lapse on its own `end_date`, which is the behaviour the dates are
 * there to express. This follows effective-dated HR assignment practice and the
 * education standards' staff/organization associations, which carry begin and end
 * dates for exactly this reason.
 *
 * Tenancy. Every query is filtered by `tenant_id` as well as the principal, per
 * `docs/audits/TENANCY_IDENTITY_INVARIANT.md`: one identity belongs to exactly one
 * tenant, so a principal resolving institutions outside its own tenant is a bug, not
 * a supported case. The tenant filter is belt-and-braces alongside RLS.
 */

/** Minimal shape so this works with a pool, a client, or a test double. */
export interface AssignmentQueryable {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
}

/**
 * Assignment statuses that confer access. Anything else — `inactive`,
 * `terminated`, `pending`, a typo — grants nothing, so the default is deny.
 */
export const ACTIVE_ASSIGNMENT_STATUSES = ['active'] as const;

/**
 * Institution ids the principal may act for, ordered so the first is stable.
 *
 * `decideInstitutionScope` injects `institutions[0]` as the primary institution on
 * unscoped list routes, so the order must not vary between requests or a user's
 * default school would drift. Ordered by `start_date` then `institution_id`:
 * longest-standing posting first, with the id as a deterministic tiebreak.
 *
 * Returns `[]` when the principal has no staff link or no active assignment. That is
 * the correct fail-closed answer — a caller with no assignments is school-bound to
 * nothing, not unscoped.
 */
export async function resolveActiveInstitutionIds(
  db: AssignmentQueryable,
  params: { tenantId: string; userId: string; asOf?: Date },
): Promise<string[]> {
  const { tenantId, userId } = params;
  if (!tenantId || !userId) return [];

  const asOf = params.asOf ?? new Date();
  const res = await db.query(
    `SELECT DISTINCT a.institution_id, a.start_date
       FROM staff_assignments a
       JOIN staff s
         ON s.id = a.staff_id
        AND s.tenant_id = a.tenant_id
      WHERE a.tenant_id = $1::uuid
        AND s.user_id = $2::uuid
        AND s.deleted_at IS NULL
        AND a.status = ANY ($3::text[])
        AND a.start_date <= $4::date
        AND (a.end_date IS NULL OR a.end_date >= $4::date)
      ORDER BY a.start_date ASC, a.institution_id ASC`,
    [tenantId, userId, [...ACTIVE_ASSIGNMENT_STATUSES], asOf],
  );

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of res.rows) {
    const id = row['institution_id'] == null ? '' : String(row['institution_id']);
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}
