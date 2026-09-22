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
 * Transaction-local (`set_config(..., true)`).
 */
export async function bindTenantGuc(client: TenantGucQueryable, tenantId: string): Promise<void> {
  assertTenantId(tenantId, 'bindTenantGuc');
  await client.query(BIND_TENANT_GUC_SQL, [tenantId]);
}

/**
 * Bind the canonical tenant GUC (and sync the legacy alias) via Prisma.
 * Prefer this over hand-rolled dual `set_config` calls.
 */
export async function bindTenantGucPrisma(
  db: TenantGucPrismaLike,
  tenantId: string,
): Promise<void> {
  assertTenantId(tenantId, 'bindTenantGucPrisma');
  await db.$executeRawUnsafe(BIND_TENANT_GUC_SQL, tenantId);
}
