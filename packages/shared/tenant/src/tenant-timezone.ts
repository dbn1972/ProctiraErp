/**
 * W3-TIME-01 — tenant timezone foundation.
 *
 * Resolves the effective IANA timezone for a tenant from the first-class
 * `tenants.timezone` column and legacy config/settings shapes. Call sites
 * should use this helper rather than hard-coding UTC while the platform
 * migrates off scattered config keys.
 */

export const DEFAULT_TENANT_TIMEZONE = 'UTC' as const;

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

/**
 * Resolves the tenant IANA timezone from known storage shapes.
 *
 * Priority (first valid IANA wins):
 * 1. `timezone` column / explicit field
 * 2. Admin settings `timezone`
 * 3. Lifecycle config `locale.timezone`
 * 4. Flat `config.timezone`
 * 5. Nested `config.locale.timezone`
 *
 * Invalid or empty values are skipped; falls back to {@link DEFAULT_TENANT_TIMEZONE}.
 */
export function resolveTenantTimezone(source: TenantTimezoneSource = {}): string {
  const candidates: unknown[] = [
    source.timezone,
    source.settings?.timezone,
    source.locale?.timezone,
    source.config?.['timezone'],
  ];

  if (source.config) {
    candidates.push(localeTimezoneFromConfig(source.config));
  }

  for (const raw of candidates) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (isValidIanaTimezone(trimmed)) return trimmed;
  }

  return DEFAULT_TENANT_TIMEZONE;
}
