/**
 * Tests for the Auth Service client (Task 49.2).
 *
 * Validates:
 *   • `fetchSignupRoles()` calls `/api/tenant/signup-roles`, normalises
 *     the response, and reports network / abort errors without throwing.
 *   • `signUp()` posts to `/api/auth/signup` with the full body including
 *     the `termsAcceptance` audit payload, and surfaces both success and
 *     error responses as a structured `SignUpResult`.
 *   • Validates Requirements 4.14, 4.15, 4.17.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUTH_API_ENDPOINTS,
  DEFAULT_PRIVACY_VERSION,
  DEFAULT_TERMS_VERSION,
  fetchSignupRoles,
  signUp,
} from './auth';

type FetchFn = typeof fetch;
type FetchMock = ReturnType<typeof vi.fn<Parameters<FetchFn>, ReturnType<FetchFn>>>;

function mockFetchOk(body: unknown): FetchMock {
  return vi.fn<Parameters<FetchFn>, ReturnType<FetchFn>>(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
}

function mockFetchError(status: number, body: unknown): FetchMock {
  return vi.fn<Parameters<FetchFn>, ReturnType<FetchFn>>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('fetchSignupRoles()', () => {
  it('calls the proxy and returns the role list on success', async () => {
    const fetchMock = mockFetchOk({
      roles: [
        { id: 'teacher', label: 'Teacher' },
        { id: 'student', label: 'Student' },
      ],
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchSignupRoles();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(AUTH_API_ENDPOINTS.SIGNUP_ROLES);
    expect(init.method).toBe('GET');
    expect(result.roles).toHaveLength(2);
    expect(result.error).toBeUndefined();
  });

  it('returns an empty list with the http status when the upstream fails', async () => {
    globalThis.fetch = mockFetchError(503, {}) as unknown as typeof fetch;
    const result = await fetchSignupRoles();
    expect(result.roles).toEqual([]);
    expect(result.error).toBe('HTTP 503');
  });

  it('returns roles=[] error="network" when fetch rejects', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('network gone');
    }) as unknown as typeof fetch;
    const result = await fetchSignupRoles();
    expect(result.roles).toEqual([]);
    expect(result.error).toBe('network');
  });

  it('returns error="aborted" when the caller cancels the request', async () => {
    globalThis.fetch = vi.fn(async () => {
      const err = new Error('aborted');
      (err as Error & { name: string }).name = 'AbortError';
      throw err;
    }) as unknown as typeof fetch;
    const result = await fetchSignupRoles();
    expect(result.error).toBe('aborted');
  });

  it('coerces a malformed payload (no `roles` array) to an empty list', async () => {
    globalThis.fetch = mockFetchOk({ unrelated: 1 }) as unknown as typeof fetch;
    const result = await fetchSignupRoles();
    expect(result.roles).toEqual([]);
    expect(result.error).toBeUndefined();
  });
});

describe('signUp()', () => {
  const PAYLOAD = {
    fullName: 'Jane Doe',
    email: 'jane@example.org',
    password: 'CorrectHorse!Battery1',
    institutionName: 'Example School',
    roleId: 'teacher',
    termsAcceptance: {
      acceptedAt: '2025-01-01T00:00:00.000Z',
      termsVersion: DEFAULT_TERMS_VERSION,
      privacyVersion: DEFAULT_PRIVACY_VERSION,
    },
  };

  beforeEach(() => {
    vi.useRealTimers();
  });

  it('posts the full payload to /api/auth/signup including the terms acceptance audit row', async () => {
    const fetchMock = mockFetchOk({ requiresApproval: true });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await signUp(PAYLOAD);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(AUTH_API_ENDPOINTS.SIGNUP);
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body.termsAcceptance).toEqual(PAYLOAD.termsAcceptance);
    expect(body.fullName).toBe('Jane Doe');
    expect(body.roleId).toBe('teacher');
    expect(result).toMatchObject({
      success: true,
      requiresApproval: true,
      email: 'jane@example.org',
    });
  });

  it('returns success=false with the upstream message on a non-OK response', async () => {
    globalThis.fetch = mockFetchError(409, {
      message: 'Email already exists.',
    }) as unknown as typeof fetch;
    const result = await signUp(PAYLOAD);
    expect(result).toEqual({
      success: false,
      message: 'Email already exists.',
    });
  });

  it('falls back to a generic message when the upstream omits one', async () => {
    globalThis.fetch = mockFetchError(500, {}) as unknown as typeof fetch;
    const result = await signUp(PAYLOAD);
    expect(result.success).toBe(false);
    expect(result.message).toBe('We could not create your account.');
  });

  it('returns a network-error result when fetch rejects', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    const result = await signUp(PAYLOAD);
    expect(result).toEqual({
      success: false,
      message: 'Network error. Please try again.',
    });
  });

  it('preserves the email on success even when the server omits it', async () => {
    globalThis.fetch = mockFetchOk({}) as unknown as typeof fetch;
    const result = await signUp(PAYLOAD);
    expect(result.success).toBe(true);
    expect(result.email).toBe(PAYLOAD.email);
  });
});
