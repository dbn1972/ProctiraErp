/**
 * W1-DATA-12 — canonical tenant GUC contract.
 *
 * Historical RLS policies split across two session variables:
 *   - `app.tenant_id`          — raw SQL / `db/sql/015+` (canonical)
 *   - `app.current_tenant_id`  — early Prisma migrations (legacy alias)
 *
 * Callers that bound only one name silently failed the other policy set.
 * This module is the single sanctioned binder: it always sets the canonical
 * GUC and syncs the legacy alias in one parameterized statement.
 *
 * SQL-side counterparts (`app_tenant_id()` / `set_app_tenant_id`) live in
 * `db/sql/071_tenant_guc_canonical.sql` and the matching Prisma migration.
 */

/** Canonical Postgres GUC used by raw-SQL RLS policies. */
export const APP_TENANT_ID_GUC = 'app.tenant_id';

/**
 * Legacy Prisma-era GUC. Kept in sync by {@link bindTenantGuc} so historical
 * policies that still read this name continue to work. New policies must use
 * `app.tenant_id` or `app_tenant_id()`.
 */
export const APP_TENANT_ID_LEGACY_GUC = 'app.current_tenant_id';

/**
 * Single-statement bind used by every sanctioned helper.
 * Parameter `$1` is the tenant id (never string-interpolated).
 */
export const BIND_TENANT_GUC_SQL = `SELECT set_config('${APP_TENANT_ID_GUC}', $1, true), set_config('${APP_TENANT_ID_LEGACY_GUC}', $1, true)`;

/** Prefer the SQL helper when `071_tenant_guc_canonical.sql` is applied. */
export const SET_APP_TENANT_ID_SQL = 'SELECT set_app_tenant_id($1)';

/**
 * NEW-g2_data-001 — Postgres stores `tenant_id` as a lowercase canonical uuid and the ~57 RLS
 * policies compare `tenant_id::text = current_setting('app.tenant_id')`. A caller that binds a
 * non-canonical (upper/mixed-case) uuid (e.g. a JWT claim or URL param that is not already
 * lowercased) would bind a GUC that never equals `tenant_id::text`, so RLS denies every row and
 * WITH CHECK writes raise 42501 — a fail-closed first-access breakage for that tenant across all
 * uuid tenant tables (the same class as the #585 document-store fix).
 *
 * This mirrors `canonicalizeDocumentTenantId`: a uuid-shaped id is lowercased before binding; a
 * non-uuid id (health stores use TEXT tenant ids) is left untouched. It is defined here (not
 * imported from the document store) to keep this low-level binder free of that dependency.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lowercase a uuid-shaped tenant id so it matches Postgres' canonical `tenant_id::text`. */
export function canonicalizeTenantGucId(tenantId: string): string {
  return UUID_SHAPE.test(tenantId) ? tenantId.toLowerCase() : tenantId;
}

function assertTenantId(tenantId: string, caller: string): void {
  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
    throw new Error(`${caller}: invalid tenantId "${tenantId}"`);
  }
}

/** Minimal node-pg surface. */
export interface TenantGucQueryable {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
}

/** Minimal Prisma interactive-transaction / client surface. */
export interface TenantGucPrismaLike {
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
}

/**
 * Bind the canonical tenant GUC (and sync the legacy alias) on a node-pg client.
 * Transaction-local (`set_config(..., true)`). The uuid-shaped id is canonicalised to lowercase
 * (NEW-g2_data-001) so it matches `tenant_id::text` in every uuid RLS policy.
 */
export async function bindTenantGuc(client: TenantGucQueryable, tenantId: string): Promise<void> {
  assertTenantId(tenantId, 'bindTenantGuc');
  await client.query(BIND_TENANT_GUC_SQL, [canonicalizeTenantGucId(tenantId)]);
}

/**
 * Bind the canonical tenant GUC (and sync the legacy alias) via Prisma.
 * Prefer this over hand-rolled dual `set_config` calls. The uuid-shaped id is canonicalised to
 * lowercase (NEW-g2_data-001) so it matches `tenant_id::text` in every uuid RLS policy.
 */
export async function bindTenantGucPrisma(
  db: TenantGucPrismaLike,
  tenantId: string,
): Promise<void> {
  assertTenantId(tenantId, 'bindTenantGucPrisma');
  await db.$executeRawUnsafe(BIND_TENANT_GUC_SQL, canonicalizeTenantGucId(tenantId));
}
