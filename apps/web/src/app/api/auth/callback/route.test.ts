/**
 * @vitest-environment node
 *
 * UATENV-D05: behind a proxy the Next standalone server sees its bind address
 * (`http://0.0.0.0:3001`) in `request.url`, so absolute redirects built from it
 * sent the browser to 0.0.0.0 after login. The callback now redirects to the
 * sanitised same-origin path with a relative Location, which the browser
 * resolves against the public URL it is on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_COOKIES } from '@/lib/auth/session';
import { GET } from './route';

const ORIGINAL_FETCH = global.fetch;

function req(query: string): Request {
  return new Request(`http://0.0.0.0:3001/api/auth/callback${query}`);
}

beforeEach(() => {
  vi.stubEnv('GATEWAY_URL', 'http://gateway.test');
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/auth/callback (UATENV-D05)', () => {
  it('redirects to the return path, not the bind address, and stores the tokens', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ accessToken: 'KC-A', refreshToken: 'KC-R', expiresIn: 300 }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;

    const res = await GET(req('?ticket=t-1&returnTo=%2Fstudents%3Fpage%3D2'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/students?page=2');
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${AUTH_COOKIES.ACCESS_TOKEN}=KC-A`);
    expect(setCookie).toContain(`${AUTH_COOKIES.REFRESH_TOKEN}=KC-R`);
  });

  it('sends a failed redemption to /login on the public origin', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 401 })) as unknown as typeof fetch;

    const res = await GET(req('?ticket=t-1&returnTo=%2Fstudents'));

    expect(res.headers.get('location')).toBe('/login?error=ticket_invalid&returnTo=%2Fstudents');
  });

  it('never redirects off-site, whatever returnTo says', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ accessToken: 'KC-A' }), { status: 200 }),
      ) as unknown as typeof fetch;

    const res = await GET(req('?ticket=t-1&returnTo=https%3A%2F%2Fevil.test%2F'));

    expect(res.headers.get('location')).toBe('/');
  });

  // Dot segments that the sanitiser accepts collapse to `//host` once the path
  // is re-resolved; a protocol-relative Location would leave the site.
  it.each(['/.//evil.com', '/%2e//evil.com', '/a/..//evil.com/x'])(
    'never emits a protocol-relative Location for returnTo=%s',
    async (returnTo) => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ accessToken: 'KC-A' }), { status: 200 }),
        ) as unknown as typeof fetch;

      const res = await GET(req(`?ticket=t-1&returnTo=${encodeURIComponent(returnTo)}`));

      const location = res.headers.get('location') ?? '';
      expect(location.startsWith('/')).toBe(true);
      expect(location.startsWith('//')).toBe(false);
      expect(new URL(location, 'https://school.example').origin).toBe('https://school.example');
    },
  );
});
