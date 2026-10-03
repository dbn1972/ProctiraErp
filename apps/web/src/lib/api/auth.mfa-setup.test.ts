/**
 * PRC-H019 — `setupMfa()` must never fabricate a TOTP secret / backup codes
 * when the enrolment route is missing or unreachable.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMfaMockAllowed, setupMfa } from './auth';

function fetcherWith(impl: () => Promise<Response>): typeof fetch {
  return vi.fn(impl) as unknown as typeof fetch;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('setupMfa (PRC-H019)', () => {
  it('returns an error, not mock data, when the route returns 404', async () => {
    const result = await setupMfa({
      fetcher: fetcherWith(async () => new Response('{}', { status: 404 })),
    });
    expect(result.kind).toBe('error');
  });

  it('returns an error, not mock data, on a network failure', async () => {
    const result = await setupMfa({
      fetcher: fetcherWith(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });
    expect(result.kind).toBe('error');
  });

  it('never returns mock data in production even with the dev flag set', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_MFA_SETUP_MOCK', 'true');
    expect(isMfaMockAllowed()).toBe(false);
    const on404 = await setupMfa({
      fetcher: fetcherWith(async () => new Response('{}', { status: 404 })),
    });
    const onNetwork = await setupMfa({
      fetcher: fetcherWith(async () => {
        throw new TypeError('offline');
      }),
    });
    expect(on404.kind).toBe('error');
    expect(onNetwork.kind).toBe('error');
  });

  it('only allows the mock behind the explicit dev flag outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_MFA_SETUP_MOCK', '');
    expect(isMfaMockAllowed()).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_MFA_SETUP_MOCK', 'true');
    expect(isMfaMockAllowed()).toBe(true);
  });

  it('PRC-H019: maps the Keycloak provider answer to a same-origin redirect', async () => {
    const ok = await setupMfa({
      fetcher: fetcherWith(
        async () =>
          new Response(JSON.stringify({ provider: 'keycloak', enrolUrl: '/api/auth/mfa/enrol' }), {
            status: 200,
          }),
      ),
    });
    expect(ok).toEqual({ kind: 'redirect', enrolUrl: '/api/auth/mfa/enrol' });
    for (const enrolUrl of ['https://evil.example/x', '//evil.example/x', '']) {
      const bad = await setupMfa({
        fetcher: fetcherWith(
          async () =>
            new Response(JSON.stringify({ provider: 'keycloak', enrolUrl }), { status: 200 }),
        ),
      });
      expect(bad.kind).toBe('error');
    }
  });
  it('passes through a real server-issued payload', async () => {
    const result = await setupMfa({
      fetcher: fetcherWith(
        async () =>
          new Response(
            JSON.stringify({
              otpauthUri: 'otpauth://totp/x?secret=ABC',
              secret: 'ABC',
              backupCodes: ['AAAA-BBBB'],
            }),
            { status: 200 },
          ),
      ),
    });
    expect(result).toEqual({
      kind: 'ok',
      data: {
        otpauthUri: 'otpauth://totp/x?secret=ABC',
        secret: 'ABC',
        backupCodes: ['AAAA-BBBB'],
      },
    });
  });
});
