/**
 * `decodeTokenPayload` is what puts a name on the screen, so it has to be
 * UTF-8-correct, not merely non-throwing.
 *
 * The previous implementation was `JSON.parse(atob(segment))`. `atob()` returns
 * a "binary string" — one UTF-16 code unit per byte — so a payload containing
 * `अनिता` came back as the mojibake `à¤...` even in the cases where the base64
 * alphabet happened not to make it throw. Nothing reported an error: the header
 * avatar, the greeting and the audit trail simply rendered garbage, and the
 * existing `session.test.ts` could not see it because its fixtures are built
 * with `btoa(JSON.stringify(...))`, which is ASCII-only by construction.
 */
import { describe, expect, it } from 'vitest';

import { decodeTokenPayload, isTokenExpired } from './session';

/** Mint a token the way a conformant issuer does: base64url, unpadded. */
function mintToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.signature-verified-upstream`;
}

const NAMES = [
  ['Devanagari', 'अनिता राव'],
  ['Arabic', 'مدرسة النور'],
  ['accented Latin', 'Chloé Lefèvre'],
  ['Han', '北京国际学校'],
  ['Tamil', 'கல்வி நிலையம்'],
  ['Bengali', 'পাঠশালা'],
  ['emoji', 'Sunrise 🌅 Campus'],
] as const;

describe('decodeTokenPayload with non-ASCII claims', () => {
  it.each(NAMES)('round-trips a %s displayName exactly', (_label, displayName) => {
    const claims = { sub: 'u-1', tenantId: 'acme', email: 'a@b.test', displayName, exp: 4_000 };

    // Guard the premise: the old implementation did not produce this value —
    // it either threw or returned mojibake.
    const segment = mintToken(claims).split('.')[1]!;
    let naive: unknown;
    try {
      naive = JSON.parse(atob(segment));
    } catch {
      naive = '<<threw>>';
    }
    expect(naive, 'fixture no longer exercises the bug').not.toEqual(claims);

    expect(decodeTokenPayload(mintToken(claims))?.displayName).toBe(displayName);
  });

  it('does not silently substitute replacement characters', () => {
    // A `fatal` TextDecoder means corrupt bytes yield null rather than a
    // string full of U+FFFD that looks like a real name.
    const decoded = decodeTokenPayload(mintToken({ sub: 'u-1', displayName: 'अनिता' }));
    expect(decoded?.displayName).not.toContain('\uFFFD');
  });

  it('still reads exp from a non-ASCII payload', () => {
    // `isTokenExpired` returns true for anything it cannot decode, so before
    // the fix a user with a non-Latin name was permanently "expired".
    const future = Math.floor(Date.now() / 1000) + 3600;
    expect(isTokenExpired(mintToken({ sub: 'u-1', displayName: 'अनिता', exp: future }))).toBe(
      false,
    );

    const past = Math.floor(Date.now() / 1000) - 3600;
    expect(isTokenExpired(mintToken({ sub: 'u-1', displayName: 'अनिता', exp: past }))).toBe(true);
  });

  it('returns null for a token that is not a JWT', () => {
    expect(decodeTokenPayload('')).toBeNull();
    expect(decodeTokenPayload('two.parts')).toBeNull();
    expect(decodeTokenPayload('aaaa.not valid base64.cccc')).toBeNull();
  });
});
