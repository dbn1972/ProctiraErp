/**
 * @vitest-environment node
 *
 * PRC-H019 — the MFA setup BFF route proxies to the auth service with the
 * session cookie and never invents a secret.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

function req(cookie?: string): NextRequest {
  const r = new NextRequest('http://localhost:3001/api/auth/mfa/setup', { method: 'POST' });
  if (cookie) r.cookies.set('access_token', cookie);
  return r;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('POST /api/auth/mfa/setup — Keycloak provider (PRC-H019 default)', () => {
  it('returns the same-origin enrol redirect and never calls upstream or emits a secret', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await POST(req('tok'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ provider: 'keycloak', enrolUrl: '/api/auth/mfa/enrol' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('still requires a session', async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/mfa/setup — auth-service provider', () => {
  beforeEach(() => {
    vi.stubEnv('MFA_ENROLMENT_PROVIDER', 'auth-service');
  });
  it('rejects unauthenticated callers with 401 without calling upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards the session as a bearer token and passes the upstream payload through', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ secret: 'S', otpauthUri: 'otpauth://x', backupCodes: ['A'] }),
          {
            status: 200,
          },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await POST(req('tok.en.sig'));
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/auth\/mfa\/setup$/);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok.en.sig');
    expect(await res.json()).toEqual({
      secret: 'S',
      otpauthUri: 'otpauth://x',
      backupCodes: ['A'],
    });
  });

  it('returns 503 (no secret) when the auth service is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('ECONNREFUSED');
      }),
    );
    const res = await POST(req('tok.en.sig'));
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.secret).toBeUndefined();
  });

  it('passes an upstream 404 through instead of fabricating enrolment data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"message":"nope"}', { status: 404 })),
    );
    const res = await POST(req('tok.en.sig'));
    expect(res.status).toBe(404);
  });
});
