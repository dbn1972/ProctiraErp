/**
 * @vitest-environment node
 *
 * UATENV-D06: a Keycloak session's user id must be the gateway's local user id.
 *
 * The gateway replaces the Keycloak `sub` with the linked local user id, so the
 * web calling `/notifications/user/<Keycloak sub>` got 403. getSession() now
 * asks the gateway (`GET /api/v1/auth/me`) for the principal of a Keycloak
 * token; platform tokens are used as they are.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieValues = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieValues.has(name) ? { name, value: cookieValues.get(name) } : undefined,
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

import { getSession } from './server';

function jwt(payload: Record<string, unknown>): string {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(payload)}.sig`;
}

const now = Math.floor(Date.now() / 1000);
const keycloakToken = jwt({
  sub: 'kc-subject-1',
  iss: 'https://keycloak.test/realms/proctira',
  azp: 'proctira-gateway',
  exp: now + 600,
  iat: now,
  email: 'teacher@school.test',
  tenant_id: 'tenant-claim',
  realm_access: { roles: ['teacher'] },
});

describe('getSession (UATENV-D06)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    cookieValues.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('GATEWAY_URL', 'http://gateway.test');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('uses the gateway local user id and tenant for a Keycloak token', async () => {
    cookieValues.set('access_token', keycloakToken);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ user: { sub: 'local-user-42', tenantId: 'tenant-linked' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const session = await getSession();

    expect(session?.user.sub).toBe('local-user-42');
    expect(session?.user.tenantId).toBe('tenant-linked');
    expect(session?.user.roles.map((role) => role.roleId)).toEqual(['teacher']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit];
    expect(String(url)).toBe('http://gateway.test/api/v1/auth/me');
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${keycloakToken}`);
  });

  it('keeps the token claims when the gateway cannot resolve the principal', async () => {
    cookieValues.set('access_token', keycloakToken);
    fetchMock.mockResolvedValue(new Response('{}', { status: 503 }));

    const session = await getSession();

    expect(session?.user.sub).toBe('kc-subject-1');
    expect(session?.user.tenantId).toBe('tenant-claim');
  });

  it('does not call the gateway for a platform token', async () => {
    cookieValues.set(
      'access_token',
      jwt({
        sub: 'local-user-1',
        tenantId: 'tenant-a',
        email: 'a@b.test',
        roles: [{ roleId: 'admin', roleName: 'Admin', areaId: 'ROOT' }],
        iat: now,
        exp: now + 600,
      }),
    );

    const session = await getSession();

    expect(session?.user.sub).toBe('local-user-1');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
