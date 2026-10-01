/**
 * "Today" as a calendar date in the tenant's timezone (PRC-L041 / PRC-L042).
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date, which is the wrong
 * day for part of every day in non-UTC tenants (e.g. 00:00–05:30 IST).
 */
import { getTenantSettings } from '@/lib/api/admin.server';

/** YYYY-MM-DD for `now` in `timeZone`; falls back to UTC for invalid zones. */
export function todayInTimeZone(
  timeZone: string | null | undefined,
  now: Date = new Date(),
): string {
  try {
    // en-CA formats dates as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Server-only: today's date in the tenant timezone from tenant settings.
 * Uses UTC when settings are unreadable for the caller.
 */
export async function getTenantToday(now: Date = new Date()): Promise<string> {
  const { settings } = await getTenantSettings().catch(() => ({ settings: null }));
  return todayInTimeZone(settings?.timezone, now);
}
