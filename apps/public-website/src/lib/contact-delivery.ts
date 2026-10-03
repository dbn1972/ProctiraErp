import { createHash } from 'node:crypto';

/** PRC-M049: shown to the visitor when the submission could not be delivered. */
export const CONTACT_FALLBACK_EMAIL = 'hello@proctira.org';

/**
 * PRC-M050: correlate log lines without storing the address: a short salted hash plus the
 * domain (useful for spotting abuse) — never the name, organisation or full email.
 */
export function maskEmailForLog(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  const domain = at >= 0 ? normalized.slice(at + 1) : 'invalid';
  const salt = process.env.CONTACT_LOG_HASH_SALT ?? 'proctira-contact';
  const digest = createHash('sha256').update(`${salt}:${normalized}`).digest('hex').slice(0, 12);
  return `sha256:${digest}@${domain}`;
}
