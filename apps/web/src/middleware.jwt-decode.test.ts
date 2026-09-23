/**
 * @vitest-environment node
 *
 * The middleware must admit a session whose JWT claims are not plain ASCII.
 *
 * ## Why this file exists
 *
 * `isAccessTokenFresh`, `isStructurallyValid` and the tenant-claim read all
 * decoded the payload with `atob()`. That implements *standard* base64, but
 * RFC 7519 mandates base64url, so the moment a claim value pushed a `-` or `_`
 * into the encoding the decode threw, the surrounding `catch` returned
 * `false`/`null`, and the request was treated as unauthenticated — a redirect
 * to `/login` on every navigation, with no error anywhere.
 *
 * Which claims do that is not random. JSON payloads are ASCII, and standard
 * base64 only emits `+`/`/` for a sextet of `111110`/`111111`, which in ASCII
 * means `?`, `>`, `~`, or any byte of a UTF-8 multi-byte sequence. So the old
 * code worked for `Anita Rao` and failed for `अनिता राव`, `مدرسة النور` and
 * `Chloé` — the populations this platform is built for. `middleware.test.ts`
 * could not catch it: that file re-implements the decode locally with `btoa`
 * fixtures instead of driving the real middleware.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { clearTenantConfigCache, middleware } from './middleware';

/** Mint a token the way a conformant issuer does: base64url, unpadded. */
function mintToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.signature-verified-upstream`;
}

function freshClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: 'user-1',
    tenantId: '00000000-0000-4000-8000-00000000ce27',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

/**
 * Mint a token whose payload segment is guaranteed to contain a base64url
 * character (`-` or `_`), i.e. one the old `atob()` decode threw on.
 *
 * Whether a given claim set trips `atob()` depends on byte *alignment*, not just
 * on which characters are present: a trigger byte only produces `+`/`/` when it
 * lands in a particular sextet of its 3-byte quantum. That is why the defect
 * read as intermittent and unattributable in the field — the same account name
 * broke or worked depending on how long the tenant id before it happened to be.
 *
 * So this shifts the payload with a leading filler claim until the property
 * actually holds, and throws if it cannot reach it. Hard-coding one claim set
 * and hoping is how you get a test that quietly stops exercising the bug the
 * next time somebody adds a field.
 */
function mintBreakingToken(claims: Record<string, unknown>): string {
  for (let fillerLength = 0; fillerLength < 4; fillerLength += 1) {
    // Filler first: JSON preserves insertion order, and only a shift *before*
    // the interesting value changes its alignment.
    const candidate = mintToken({ _pad: 'x'.repeat(fillerLength), ...claims });
    const segment = candidate.split('.')[1]!;
    if (/[-_]/.test(segment)) return candidate;
  }
  throw new Error(
    `could not construct a payload that exercises the base64url bug from ${JSON.stringify(claims)}`,
  );
}

function request(path: string, accessToken: string): NextRequest {
  const req = new NextRequest(`http://localhost:3001${path}`);
  req.cookies.set('access_token', accessToken);
  req.cookies.set('refresh_token', 'refresh-token-value');
  return req;
}

/** A protected route: reaching it proves the token was accepted. */
const PROTECTED = '/students';

describe('middleware JWT payload decoding', () => {
  beforeEach(() => {
    clearTenantConfigCache();
  });

  it.each([
    ['Devanagari school name', 'अनिता राव विद्यालय'],
    ['Arabic school name', 'مدرسة النور'],
    ['accented Latin name', 'Chloé Lefèvre'],
    ['Han name', '北京国际学校'],
    ['a question mark in a claim', 'Who? Academy'],
    ['a tilde in a claim', 'Sunrise ~ Campus'],
  ])('admits a session whose displayName is %s', async (_label, displayName) => {
    const token = mintBreakingToken(freshClaims({ displayName }));

    // Guard the premise: this token is exactly the kind the old decode rejected.
    const segment = token.split('.')[1]!;
    expect(() => atob(segment), 'fixture no longer exercises the bug').toThrow();

    const response = await middleware(request(PROTECTED, token));

    expect(
      response.headers.get('location'),
      `redirected instead of admitting a ${_label}`,
    ).toBeNull();
    expect(response.status).toBe(200);
  });

  it('forwards the tenant claim from a non-ASCII token', async () => {
    const token = mintBreakingToken(
      freshClaims({ displayName: 'अनिता', tenantId: 'tenant-from-claim' }),
    );
    const response = await middleware(request(PROTECTED, token));

    // Before the fix the claim read was inside a `try {} catch {}` that
    // swallowed the throw, silently leaving the subdomain-resolved tenant in
    // place — a request executed against the wrong tenant context.
    expect(response.headers.get('X-Tenant-ID')).toBe('tenant-from-claim');
  });

  it('applies portal role bouncing to a non-ASCII token', async () => {
    // The role redirect lived in the same swallowed `try`, so a student with a
    // Devanagari name kept access to `/parent`.
    const token = mintBreakingToken(
      freshClaims({ displayName: 'अनिता', roles: [{ roleId: 'student', roleName: 'Student' }] }),
    );
    const response = await middleware(request('/parent', token));
    expect(response.headers.get('location')).toContain('/student');
  });

  it('still rejects an expired token with non-ASCII claims', async () => {
    // The complement: leniency about the alphabet must not become leniency
    // about expiry.
    const token = mintBreakingToken(
      freshClaims({ displayName: 'Chloé', exp: Math.floor(Date.now() / 1000) - 3600 }),
    );
    const response = await middleware(request(PROTECTED, token));
    expect(response.headers.get('location')).toContain('/login');
  });

  it('still rejects a structurally invalid token', async () => {
    for (const token of ['', 'one-part', 'two.parts', 'aaaa.not valid base64.cccc']) {
      const response = await middleware(request(PROTECTED, token));
      expect(response.headers.get('location'), `accepted ${JSON.stringify(token)}`).toContain(
        '/login',
      );
    }
  });

  it('accepts a token minted with standard base64, as several fixtures do', async () => {
    // Deliberate leniency in `@proctira/common/jwt`: we read tokens minted
    // elsewhere, and rejecting a decodable one costs a login loop.
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
    const payload = Buffer.from(JSON.stringify(freshClaims())).toString('base64');
    const response = await middleware(request(PROTECTED, `${header}.${payload}.sig`));
    expect(response.headers.get('location')).toBeNull();
  });
});
