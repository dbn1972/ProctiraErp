// @vitest-environment node
/**
 * PRC-L254: server `getSession()` (BFF authorisation + SSR session gate)
 * returns a session only for a token whose signature, issuer and audience
 * verify against the IdP JWKS. Base decoded the payload with no verification,
 * so a forged or `alg: none` token produced a session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetShellTokenVerifierCache } from '@proctira/auth';
import {
  TEST_JWKS_ENV,
  forgedToken,
  hmacToken,
  signedToken,
  tamperedToken,
  unsignedToken,
  withTestJwks,
} from './jwks-test-fixture';

const cookieJar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

const fetchMock = vi.fn(withTestJwks(async () => new Response('unexpected', { status: 500 })));

beforeEach(() => {
  cookieJar.clear();
  __resetShellTokenVerifierCache();
  vi.stubGlobal('fetch', fetchMock);
  for (const [k, v] of Object.entries(TEST_JWKS_ENV)) vi.stubEnv(k, v);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function sessionFor(token: string) {
  cookieJar.set('access_token', token);
  const { getSession } = await import('./server');
  return getSession();
}

describe('getSession with JWKS verification (PRC-L254)', () => {
  it('returns the session for an authentic token (positive control)', async () => {
    const session = await sessionFor(signedToken());
    expect(session?.user.sub).toBe('user-1');
    expect(session?.user.tenantId).toBe('tenant-a');
    expect(session?.isExpired).toBe(false);
  });

  it.each([
    ['forged (signed by a key not in the JWKS)', forgedToken()],
    ['unsigned (alg: none)', unsignedToken()],
    ['HMAC with an attacker secret', hmacToken()],
    ['payload edited after signing', tamperedToken({ tenantId: 'tenant-b' })],
    ['wrong issuer', signedToken({ iss: 'https://evil.test/realms/x' })],
    ['wrong audience / client', signedToken({ azp: 'other-client' })],
  ])('returns no session for a %s token', async (_label, token) => {
    expect(await sessionFor(token)).toBeNull();
  });

  it('reads the Keycloak tenant_id claim as tenantId', async () => {
    const session = await sessionFor(signedToken({ tenantId: undefined, tenant_id: 'tenant-k' }));
    expect(session?.user.tenantId).toBe('tenant-k');
  });

  it('keeps an authentic expired token as an expired session (refresh path)', async () => {
    const session = await sessionFor(signedToken({ exp: Math.floor(Date.now() / 1000) - 60 }));
    expect(session?.isExpired).toBe(true);
  });

  it('fails closed in a deployed stage when no JWKS is configured', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('KEYCLOAK_ISSUER', '');
    vi.stubEnv('KEYCLOAK_CLIENT_ID', '');
    vi.stubEnv('APP_ENV', 'production');
    expect(await sessionFor(signedToken())).toBeNull();
  });
});
