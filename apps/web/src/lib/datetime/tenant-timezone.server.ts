import { getTenantSettings } from '@/lib/api/admin.server';
import { DEFAULT_TENANT_TIMEZONE, wallClockToUtcIso } from './tenant-zoned';

/** Tenant IANA timezone from `/tenant/settings`, falling back to Asia/Kolkata. */
export async function resolveTenantTimezone(): Promise<string> {
  try {
    const { settings } = await getTenantSettings();
    return settings?.timezone?.trim() || DEFAULT_TENANT_TIMEZONE;
  } catch {
    return DEFAULT_TENANT_TIMEZONE;
  }
}

/**
 * Convert a browser wall-clock value (date / datetime-local) to a UTC ISO string
 * in the tenant timezone. Throws on unparseable input so callers surface a
 * validation error rather than storing a wrong deadline.
 */
export async function toTenantUtcIso(value: string | undefined): Promise<string | undefined> {
  if (!value || !value.trim()) return undefined;
  const iso = wallClockToUtcIso(value, await resolveTenantTimezone());
  if (!iso) throw new Error('Enter a valid date and time.');
  return iso;
}
