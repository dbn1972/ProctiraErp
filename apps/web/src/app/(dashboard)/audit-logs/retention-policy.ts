/**
 * PRC-L032 / PRC-L256: audit retention has a statutory floor. A 1-month
 * retention would let an operator erase the audit trail almost immediately.
 * The minimum is configurable per deployment (AUDIT_RETENTION_MIN_MONTHS) but
 * can never drop below a hard 12-month floor, and the policy ceiling is 120
 * months. Enforced server-side so the UI cannot bypass it.
 */
export const AUDIT_RETENTION_HARD_FLOOR_MONTHS = 12;
export const AUDIT_RETENTION_MAX_MONTHS = 120;

export function minAuditRetentionMonths(): number {
  const raw = Number.parseInt(process.env['AUDIT_RETENTION_MIN_MONTHS'] ?? '', 10);
  if (Number.isFinite(raw) && raw > AUDIT_RETENTION_HARD_FLOOR_MONTHS) {
    return Math.min(raw, AUDIT_RETENTION_MAX_MONTHS);
  }
  return AUDIT_RETENTION_HARD_FLOOR_MONTHS;
}
