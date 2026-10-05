/**
 * PRC-L358: tenant timezone validation on admin writes.
 *
 * The runtime resolver silently falls back to UTC for an unknown zone, which shifts attendance
 * cut-offs and due dates by hours for a mistyped tenant (e.g. "Asia/Calcuta"). Admin writes
 * therefore reject anything that is not an exact IANA zone id accepted by the runtime registry:
 * no surrounding whitespace, no empty value, and no offset strings such as "+05:30".
 */
import type { FieldError } from '@proctira/common';

const IANA_ZONE_SHAPE = /^(UTC|Etc\/[A-Za-z0-9+-]+|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+)$/;

/** True only for an exact (untrimmed) IANA zone id the runtime understands. */
export function isValidTenantTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) return false;
  if (!IANA_ZONE_SHAPE.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Field error for an invalid timezone, or null when valid. */
export function tenantTimezoneFieldError(value: unknown, field = 'timezone'): FieldError | null {
  if (isValidTenantTimezone(value)) return null;
  return {
    field,
    rule: 'iana_timezone',
    message: 'timezone must be a valid IANA timezone (for example "Asia/Kolkata")',
  };
}
