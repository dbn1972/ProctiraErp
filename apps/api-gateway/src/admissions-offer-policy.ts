/**
 * PRC-L002: money and calendar rules for the admissions offer → enrolment path.
 *
 * - Offer fee amounts go through the shared `majorUnitsToCents` (no bare float `* 100`), so
 *   sub-cent or non-finite amounts are rejected instead of silently rounded.
 * - The enrolment date and admission-number year follow the tenant's local calendar
 *   (IANA timezone from tenant config, default Asia/Kolkata), not the UTC calendar —
 *   an offer accepted at 00:30 IST on 1 January belongs to the new year.
 */
import { majorUnitsToCents } from '@proctira/backend-fees';

export const DEFAULT_TENANT_TIMEZONE = 'Asia/Kolkata';

/** Convert an offer fee (major units) to non-negative integer cents, rejecting invalid input. */
export function offerFeeAmountCents(feeAmount: number | string): number {
  return majorUnitsToCents(feeAmount);
}

/** Return `timeZone` if it is a valid IANA zone, otherwise the platform default. */
export function resolveTenantTimeZone(timeZone: unknown): string {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') return DEFAULT_TENANT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_TENANT_TIMEZONE;
  }
}

function validZone(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const zone = value.trim();
  return resolveTenantTimeZone(zone) === zone ? zone : null;
}

/**
 * PRC-L002: the tenant's admissions calendar zone, read on the caller's tenant-bound transaction
 * (RLS). Priority: admin-console tenant settings (`tenant.settings` document — what the school
 * edits), then `tenants.config.locale.timezone`, then flat `tenants.config.timezone`; otherwise
 * {@link DEFAULT_TENANT_TIMEZONE} (the platform default is an open decision, PRC-L358).
 * Invalid zones are skipped. Never elevates the transaction (no platform scope).
 */
export async function loadAdmissionsTimeZone(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
  tenantId: string,
): Promise<string> {
  // `id` is TEXT and `tenant_id` is UUID (db/sql/100): cast each use of the shared parameter, or
  // Postgres infers $1 as text and `tenant_id = $1` fails with "operator does not exist".
  const settings = await client.query(
    `SELECT data->>'timezone' AS tz
       FROM control_plane_documents
      WHERE collection = 'tenant.settings' AND id = $1::text AND tenant_id = $1::uuid
      LIMIT 1`,
    [tenantId],
  );
  const fromSettings = validZone((settings.rows[0] as { tz?: unknown } | undefined)?.tz);
  if (fromSettings) return fromSettings;
  const tenant = await client.query(
    `SELECT config->'locale'->>'timezone' AS locale_tz, config->>'timezone' AS flat_tz
       FROM tenants WHERE id = $1::uuid`,
    [tenantId],
  );
  const row = tenant.rows[0] as { locale_tz?: unknown; flat_tz?: unknown } | undefined;
  return validZone(row?.locale_tz) ?? validZone(row?.flat_tz) ?? DEFAULT_TENANT_TIMEZONE;
}

/** Calendar date (YYYY-MM-DD) of `now` in the tenant timezone. */
export function tenantLocalDate(now: Date, timeZone: unknown): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolveTenantTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Admission number `ADM-<tenant-local year>-<seq padded to 4>`. */
export function formatAdmissionNumber(now: Date, timeZone: unknown, seq: number): string {
  const year = tenantLocalDate(now, timeZone).slice(0, 4);
  return `ADM-${year}-${String(seq).padStart(4, '0')}`;
}
