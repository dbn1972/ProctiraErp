/**
 * G-504 — JWT dual-secret / kid rotation helpers.
 *
 * During rotation:
 *   1. Set JWT_SECRET to the new value and JWT_SECRET_PREVIOUS to the old.
 *   2. New tokens are signed with JWT_SECRET (kid=current).
 *   3. Tokens signed with the previous secret still verify until expiry.
 *   4. After max access-token lifetime, clear JWT_SECRET_PREVIOUS.
 *
 * See docs/SECRETS_ROTATION.md.
 */

export interface JwtSecretPair {
  /** Active signing + preferred verify secret. */
  current: string;
  /** Previous secret still accepted for verify (optional). */
  previous?: string;
  /** kid claim written on newly signed tokens. */
  currentKid: string;
  previousKid: string;
}

export function loadJwtSecretPair(env: NodeJS.ProcessEnv = process.env): JwtSecretPair {
  const current =
    env['JWT_SECRET']?.trim() ||
    (env['NODE_ENV'] === 'production' ? '' : 'dev-secret-change-in-production');
  if (!current) {
    throw new Error('JWT_SECRET is required');
  }
  const previous = env['JWT_SECRET_PREVIOUS']?.trim() || undefined;
  return {
    current,
    previous: previous && previous !== current ? previous : undefined,
    currentKid: env['JWT_KID']?.trim() || 'current',
    previousKid: env['JWT_PREVIOUS_KID']?.trim() || 'previous',
  };
}

/**
 * Resolve which secret to use for verification based on JWT header kid.
 * Tokens without kid fall back to current, then previous (caller tries both).
 */
export function secretForKid(pair: JwtSecretPair, kid: string | undefined): string | undefined {
  if (!kid || kid === pair.currentKid) return pair.current;
  if (kid === pair.previousKid) return pair.previous ?? pair.current;
  return pair.current;
}

/**
 * Ordered secrets to attempt during verify (current first, then previous).
 */
export function verifySecretCandidates(pair: JwtSecretPair): string[] {
  const out = [pair.current];
  if (pair.previous) out.push(pair.previous);
  return out;
}
