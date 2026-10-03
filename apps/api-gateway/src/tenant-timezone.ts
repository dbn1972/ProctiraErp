/**
 * PRC-L104 — per-tenant IANA timezone for domain calendar-date rules (exam 7-day window, …).
 *
 * Priority: the admin-console tenant settings (`tenant.settings.timezone`, what the school
 * edits), then the first-class `tenants.timezone` column / legacy config keys. Without Postgres
 * there is no tenant record to read and the platform default applies. Results are cached
 * briefly per tenant; a lookup failure propagates (the caller answers 5xx) rather than silently
 * evaluating a school's dates in the wrong zone.
 */
import { PgTenantSettingsStore } from '@proctira/backend-tenant';
import { getSharedPgPool, withPgTenant, type PgPoolWithConnect } from '@proctira/database';
import { DEFAULT_TENANT_TIMEZONE, resolveTenantTimezoneDetailed } from '@proctira/tenant';

export type TenantTimeZoneResolver = (tenantId: string) => Promise<string>;

export interface TenantTimeZoneSources {
  /** Admin settings document `timezone`, or null when none is stored. */
  settingsTimezone(tenantId: string): Promise<unknown>;
  /** `tenants.timezone` column and `tenants.config`, or null when the row is absent. */
  tenantRow(tenantId: string): Promise<{ timezone?: unknown; config?: unknown } | null>;
}

export function createTenantTimeZoneResolver(options: {
  sources: TenantTimeZoneSources | null;
  ttlMs?: number;
  now?: () => number;
}): TenantTimeZoneResolver {
  const ttlMs = options.ttlMs ?? 60_000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { zone: string; expiresAt: number }>();
  return async (tenantId: string) => {
    const sources = options.sources;
    if (!sources || !tenantId) return DEFAULT_TENANT_TIMEZONE;
    const hit = cache.get(tenantId);
    if (hit && hit.expiresAt > now()) return hit.zone;
    const fromSettings = resolveTenantTimezoneDetailed({
      settings: { timezone: await sources.settingsTimezone(tenantId) },
    });
    let zone = fromSettings.timezone;
    if (fromSettings.fellBack) {
      const row = await sources.tenantRow(tenantId);
      const config =
        row?.config && typeof row.config === 'object' && !Array.isArray(row.config)
          ? (row.config as Record<string, unknown>)
          : null;
      zone = resolveTenantTimezoneDetailed({ timezone: row?.timezone, config }).timezone;
    }
    cache.set(tenantId, { zone, expiresAt: now() + ttlMs });
    return zone;
  };
}

/** Postgres-backed sources (RLS-scoped reads); null when no database is configured. */
export function pgTenantTimeZoneSources(
  pool: PgPoolWithConnect | null = getSharedPgPool(),
): TenantTimeZoneSources | null {
  if (!pool) return null;
  const settings = new PgTenantSettingsStore(pool);
  return {
    settingsTimezone: async (tenantId) => (await settings.get(tenantId))?.timezone ?? null,
    tenantRow: async (tenantId) =>
      withPgTenant(pool, tenantId, async (client) => {
        const result = await client.query(
          `SELECT timezone, config FROM tenants WHERE id = $1::uuid LIMIT 1`,
          [tenantId],
        );
        return (result.rows[0] as { timezone?: unknown; config?: unknown } | undefined) ?? null;
      }),
  };
}
