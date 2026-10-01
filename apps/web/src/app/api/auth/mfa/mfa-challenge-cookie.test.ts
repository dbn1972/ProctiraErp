/**
 * PRC-L024: the MFA challenge token must never be exposed to client JS or the
 * /mfa URL. /api/auth/login stores it in an httpOnly cookie scoped to
 * /api/auth/mfa, and /api/auth/mfa/verify reads it from that cookie.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as login } from '../login/route';
import { POST as verify } from './verify/route';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MFA challenge cookie (PRC-L024)', () => {
  it('login keeps the challenge token out of the JSON body and sets an httpOnly cookie', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ requiresMfa: true, mfaToken: 'challenge-abc' })),
    );
    const res = await login(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.test', password: 'pw' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ requiresMfa: true });
    expect(JSON.stringify(body)).not.toContain('challenge-abc');

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('mfa_challenge=challenge-abc');
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie).toContain('Path=/api/auth/mfa');
    expect(setCookie.toLowerCase()).toContain('samesite=strict');
  });

  it('verify uses the challenge cookie when the body carries no token and clears it', async () => {
    const upstream = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ tokens: { accessToken: 'a', refreshToken: 'r', expiresIn: 900 } }),
      );
    vi.stubGlobal('fetch', upstream);
    const res = await verify(
      new Request('http://localhost/api/auth/mfa/verify', {
        method: 'POST',
        headers: { cookie: 'mfa_challenge=challenge-abc' },
        body: JSON.stringify({ code: '123456' }),
      }),
    );
    expect(res.status).toBe(200);
    const sent = JSON.parse(String(upstream.mock.calls[0]![1]!.body)) as Record<string, unknown>;
    expect(sent).toEqual({ mfaToken: 'challenge-abc', code: '123456' });
    expect(res.headers.get('set-cookie') ?? '').toMatch(/mfa_challenge=;[^,]*Max-Age=0/);
  });

  it('verify rejects with 401 when neither cookie nor body token is present', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const res = await verify(
      new Request('http://localhost/api/auth/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({ code: '123456' }),
      }),
    );
    expect(res.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });
});
