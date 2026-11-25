/**
 * PRC-L341: schedule recipients receive links to report exports that can hold
 * student PII, so they are validated before a schedule is stored:
 * - each entry is an email address (trimmed, lower-cased);
 * - duplicates are removed and at most {@link MAX_SCHEDULE_RECIPIENTS} remain;
 * - when an allow-list of school domains is configured
 *   (`REPORT_RECIPIENT_ALLOWED_DOMAINS`, comma-separated), each address's
 *   domain must be on it;
 * - when `requireAllowedDomains` is set (the plugin sets it for production-like
 *   environments that actually deliver email), recipients are refused until an
 *   allow-list exists (fail closed). Without live delivery nothing is sent, so
 *   any well-formed address is accepted.
 */
import { ValidationError } from '@proctira/common';

export const MAX_SCHEDULE_RECIPIENTS = 20;

/** Pragmatic address check: one `@`, no whitespace, dotted domain, length caps. */
const EMAIL_RE =
  /^[^\s@]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export interface ScheduleRecipientPolicy {
  /** Allowed recipient email domains (exact match, lower-case). Empty/absent = none configured. */
  allowedDomains?: readonly string[] | null;
  /** Refuse recipients while no allow-list is configured (live delivery in production). */
  requireAllowedDomains?: boolean;
}

/** Parse `REPORT_RECIPIENT_ALLOWED_DOMAINS` (comma-separated domains). */
export function readAllowedRecipientDomains(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return (env['REPORT_RECIPIENT_ALLOWED_DOMAINS'] ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export function normalizeScheduleRecipients(
  recipients: readonly string[] | undefined,
  policy: ScheduleRecipientPolicy = {},
): string[] {
  const unique = [...new Set((recipients ?? []).map((r) => r.trim().toLowerCase()))].filter(
    Boolean,
  );
  if (unique.length === 0) return [];
  const invalid = unique.filter((r) => r.length > 254 || !EMAIL_RE.test(r));
  if (invalid.length > 0) {
    throw new ValidationError('Invalid recipient email address', [
      { field: 'recipients', rule: 'format', message: 'Each recipient must be an email address' },
    ]);
  }
  if (unique.length > MAX_SCHEDULE_RECIPIENTS) {
    throw new ValidationError('Too many recipients', [
      {
        field: 'recipients',
        rule: 'maxItems',
        message: `At most ${MAX_SCHEDULE_RECIPIENTS} distinct recipients are allowed`,
      },
    ]);
  }
  const allowed = new Set((policy.allowedDomains ?? []).map((d) => d.trim().toLowerCase()));
  if (allowed.size === 0) {
    if (policy.requireAllowedDomains) {
      throw new ValidationError('Schedule recipients are not enabled', [
        {
          field: 'recipients',
          rule: 'inTenant',
          message: 'No school email domains are configured for report delivery',
        },
      ]);
    }
    return unique;
  }
  const outside = unique.filter((r) => !allowed.has(r.slice(r.lastIndexOf('@') + 1)));
  if (outside.length > 0) {
    throw new ValidationError('Recipient outside the school email domains', [
      {
        field: 'recipients',
        rule: 'inTenant',
        message: 'Recipients must use one of the school email domains',
      },
    ]);
  }
  return unique;
}
