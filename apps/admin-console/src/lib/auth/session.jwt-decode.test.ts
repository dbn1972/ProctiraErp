/**
 * The admin console carried its own copy of the `atob()` token decode, so it
 * carried its own copy of the bug: a platform operator whose display name is
 * not plain ASCII could be bounced to `/login` on every navigation, and their
 * name rendered as mojibake when it was not.
 *
 * `decodeAdminToken` now delegates to `@proctira/common/jwt`. These tests pin
 * the behaviour from the consumer's side so the delegation cannot be quietly
 * reverted to a local implementation.
 */
import { describe, expect, it } from 'vitest';

import { decodeAdminToken, isAdminTokenExpired } from './session';

/** Mint a token the way a conformant issuer does: base64url, unpadded. */
function mintToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.signature-verified-upstream`;
}

describe('decodeAdminToken with non-ASCII claims', () => {
  it.each([
    ['Devanagari', 'अनिता राव'],
    ['Arabic', 'مدرسة النور'],
    ['accented Latin', 'Chloé Lefèvre'],
    ['Han', '北京国际学校'],
  ])('round-trips a %s displayName exactly', (_label, displayName) => {
    const claims = {
      sub: 'op-1',
      email: 'op@platform.test',
      displayName,
      tenantId: 'platform',
      iat: 1,
      exp: 4_000,
    };

    // Guard the premise: the old local implementation produced something else.
    const segment = mintToken(claims).split('.')[1]!;
    let naive: unknown;
    try {
      naive = JSON.parse(atob(segment));
    } catch {
      naive = '<<threw>>';
    }
    expect(naive, 'fixture no longer exercises the bug').not.toEqual(claims);

    expect(decodeAdminToken(mintToken(claims))).toEqual(claims);
  });

  it('reads exp from a non-ASCII payload', () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    expect(isAdminTokenExpired(mintToken({ displayName: 'अनिता', exp: future }))).toBe(false);

    const past = Math.floor(Date.now() / 1000) - 3600;
    expect(isAdminTokenExpired(mintToken({ displayName: 'अनिता', exp: past }))).toBe(true);
  });

  it('returns null for a token that is not a JWT', () => {
    expect(decodeAdminToken('')).toBeNull();
    expect(decodeAdminToken('two.parts')).toBeNull();
    expect(decodeAdminToken('aaaa.not valid base64.cccc')).toBeNull();
  });
});
