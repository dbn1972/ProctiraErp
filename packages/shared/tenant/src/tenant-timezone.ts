/**
 * W3-TIME-01 — tenant timezone foundation.
 *
 * Resolves the effective IANA timezone for a tenant from the first-class
 * `tenants.timezone` column and legacy config/settings shapes. Call sites
 * should use this helper rather than hard-coding UTC while the platform
 * migrates off scattered config keys.
 */

export const DEFAULT_TENANT_TIMEZONE = 'UTC';

/** Config/settings shapes that may carry a tenant IANA timezone. */
export interface TenantTimezoneSource {
  /** Value from `tenants.timezone` when loaded from Postgres. */
  timezone?: unknown;
  /** Nested locale block from tenant lifecycle config. */
  locale?: { timezone?: unknown } | null;
  /** Flat or nested payload from `tenants.config`. */
  config?: Record<string, unknown> | null;
  /** Admin-console settings document (`tenant.settings`). */
  settings?: { timezone?: unknown } | null;
}

/**
 * Returns true when `value` is accepted by the runtime IANA registry.
 */
export function isValidIanaTimezone(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

function localeTimezoneFromConfig(config: Record<string, unknown>): unknown {
  const locale = config['locale'];
  if (typeof locale !== 'object' || locale === null) return undefined;
  return (locale as Record<string, unknown>)['timezone'];
}

/** Where the resolved timezone came from. */
export type TenantTimezoneOrigin =
  'timezone' | 'settings' | 'locale' | 'config' | 'config.locale' | 'default';

/** Detailed resolution result so callers can warn/reject instead of silently using UTC. */
export interface TenantTimezoneResolution {
  timezone: string;
  source: TenantTimezoneOrigin;
  /** True when no valid candidate was found and {@link DEFAULT_TENANT_TIMEZONE} was used. */
  fellBack: boolean;
  /** Non-empty string candidates that were rejected as invalid IANA zones. */
  rejected: string[];
}

/**
 * Resolves the tenant IANA timezone and reports the origin, whether it fell back
 * to the default, and which configured values were rejected (PRC-L358).
 *
 * Priority (first valid IANA wins):
 * 1. `timezone` column / explicit field
 * 2. Admin settings `timezone`
 * 3. Lifecycle config `locale.timezone`
 * 4. Flat `config.timezone`
 * 5. Nested `config.locale.timezone`
 */
export function resolveTenantTimezoneDetailed(
  source: TenantTimezoneSource = {},
): TenantTimezoneResolution {
  const candidates: Array<[TenantTimezoneOrigin, unknown]> = [
    ['timezone', source.timezone],
    ['settings', source.settings?.timezone],
    ['locale', source.locale?.timezone],
    ['config', source.config?.['timezone']],
  ];

  if (source.config) {
    candidates.push(['config.locale', localeTimezoneFromConfig(source.config)]);
  }

  const rejected: string[] = [];
  for (const [origin, raw] of candidates) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (isValidIanaTimezone(trimmed)) {
      return { timezone: trimmed, source: origin, fellBack: false, rejected };
    }
    rejected.push(trimmed);
  }

  return { timezone: DEFAULT_TENANT_TIMEZONE, source: 'default', fellBack: true, rejected };
}

/**
 * Resolves the tenant IANA timezone from known storage shapes.
 *
 * Invalid or empty values are skipped; falls back to {@link DEFAULT_TENANT_TIMEZONE}.
 * Use {@link resolveTenantTimezoneDetailed} to detect the fallback.
 */
export function resolveTenantTimezone(source: TenantTimezoneSource = {}): string {
  return resolveTenantTimezoneDetailed(source).timezone;
}
