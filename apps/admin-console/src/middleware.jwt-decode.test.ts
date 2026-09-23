/**
 * @vitest-environment node
 *
 * The admin console's middleware must admit a session whose JWT claims are not
 * plain ASCII.
 *
 * `isAccessTokenFresh` decoded the payload with `atob()`, which implements
 * standard base64 and throws on the `-`/`_` that RFC 7519 requires. The `catch`
 * returned `false`, so the operator was redirected to `/login` on every
 * navigation with nothing logged. Nothing drove this middleware in a test — the
 * app's only coverage was of `isPublicPath`, `sanitizeReturnTo` and
 * `decodeAdminToken` in isolation — so the defect was invisible here and had to
 * be found in `apps/web` first.
 *
 * This file also pins the app's first cross-package import into edge-runtime
 * code (`@proctira/common/jwt`), so a resolution or transpile regression fails
 * a test rather than only a production build.
 */
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { middleware } from './middleware';

/** Mint a token the way a conformant issuer does: base64url, unpadded. */
function mintToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.signature-verified-upstream`;
}

/**
 * Mint a token whose payload provably contains a base64url character, i.e. one
 * the old `atob()` decode threw on.
 *
 * Whether a claim set trips `atob()` depends on byte *alignment*, not only on
 * which characters are present, so this shifts the payload with a leading
 * filler claim until the property holds and throws if it cannot reach it.
 */
function mintBreakingToken(claims: Record<string, unknown>): string {
  for (let fillerLength = 0; fillerLength < 4; fillerLength += 1) {
    const candidate = mintToken({ _pad: 'x'.repeat(fillerLength), ...claims });
    if (/[-_]/.test(candidate.split('.')[1]!)) return candidate;
  }
  throw new Error(
    `could not construct a payload that exercises the base64url bug from ${JSON.stringify(claims)}`,
  );
}

function freshClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: 'operator-1',
    email: 'operator@platform.test',
    tenantId: 'platform',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

function request(path: string, accessToken?: string): NextRequest {
  const req = new NextRequest(`http://localhost:3014${path}`);
  if (accessToken !== undefined) req.cookies.set('admin_access_token', accessToken);
  return req;
}

/** A protected route: reaching it proves the token was accepted. */
const PROTECTED = '/tenants';

describe('admin-console middleware JWT decoding', () => {
  it.each([
    ['Devanagari', 'अनिता राव'],
    ['Arabic', 'مدرسة النور'],
    ['accented Latin', 'Chloé Lefèvre'],
    ['Han', '北京国际学校'],
  ])('admits an operator whose displayName is %s', (_label, displayName) => {
    const token = mintBreakingToken(freshClaims({ displayName }));

    // Guard the premise: this is the kind of token the old decode rejected.
    expect(() => atob(token.split('.')[1]!), 'fixture no longer exercises the bug').toThrow();

    const response = middleware(request(PROTECTED, token));

    expect(response.headers.get('location'), `redirected a ${_label} name`).toBeNull();
    expect(response.headers.get('X-Platform-Admin')).toBe('true');
  });

  it.each([
    ['no cookie', undefined],
    ['an empty token', ''],
    ['a non-JWT', 'two.parts'],
    ['a payload outside both base64 alphabets', 'aaaa.not valid base64.cccc'],
  ])('still redirects %s to /login', (_label, token) => {
    const response = middleware(request(PROTECTED, token));
    expect(response.headers.get('location')).toContain('/login');
  });

  it('still redirects an expired non-ASCII session to /login', () => {
    // Leniency about the alphabet must not become leniency about expiry.
    const token = mintBreakingToken(
      freshClaims({ displayName: 'अनिता', exp: Math.floor(Date.now() / 1000) - 3600 }),
    );
    const response = middleware(request(PROTECTED, token));
    expect(response.headers.get('location')).toContain('/login');
  });

  it('does not admit a session on the strength of an unreadable exp', () => {
    const token = mintToken(freshClaims({ exp: 'soon' }));
    const response = middleware(request(PROTECTED, token));
    expect(response.headers.get('location')).toContain('/login');
  });

  it('evaluates a string exp rather than ignoring it', () => {
    const past = String(Math.floor(Date.now() / 1000) - 3600);
    expect(
      middleware(request(PROTECTED, mintToken(freshClaims({ exp: past })))).headers.get('location'),
    ).toContain('/login');

    const future = String(Math.floor(Date.now() / 1000) + 3600);
    expect(
      middleware(request(PROTECTED, mintToken(freshClaims({ exp: future })))).headers.get(
        'location',
      ),
    ).toBeNull();
  });

  it('leaves the login page reachable without a token', () => {
    // The complement: if everything redirected, the suite above would be
    // asserting nothing.
    expect(middleware(request('/login')).headers.get('location')).toBeNull();
  });
});
