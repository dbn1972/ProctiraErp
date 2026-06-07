/**
 * Tests for the `POST /api/auth/signup` Next.js route handler
 * (Task 49.6, Requirement 4 AC 14).
 *
 * Coverage:
 *   • Weak passwords are rejected with HTTP 422 and the
 *     `WEAK_PASSWORD` error code BEFORE any upstream call is made.
 *   • Strong passwords flow through to the upstream Auth Service.
 *   • Missing required fields still return 400 (regression guard).
 *   • Missing terms acceptance still returns 400 (regression guard).
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';

import { POST } from './route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_TERMS = {
  acceptedAt: '2025-01-01T00:00:00.000Z',
  termsVersion: 'tos-2025-01-15',
  privacyVersion: 'privacy-2025-01-15',
};

const VALID_BASE = {
  fullName: 'Jane Doe',
  email: 'jane@example.org',
  institutionName: 'Example School',
  roleId: 'principal',
  termsAcceptance: VALID_TERMS,
};

describe('POST /api/auth/signup — weak password rejection (Task 49.6)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ requiresApproval: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('rejects a weak password with 422 and code WEAK_PASSWORD', async () => {
    const response = await POST(
      makeRequest({ ...VALID_BASE, password: 'password' }),
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe('WEAK_PASSWORD');
    expect(typeof body.message).toBe('string');
    // Critically: the upstream must NOT have been called.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a short common password with 422', async () => {
    const response = await POST(
      makeRequest({ ...VALID_BASE, password: '12345678' }),
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe('WEAK_PASSWORD');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards a strong password to the upstream Auth Service', async () => {
    const response = await POST(
      makeRequest({ ...VALID_BASE, password: 'Tr0ub4dor&3xQrSt' }),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/auth\/signup$/);
    expect(init.method).toBe('POST');
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.requiresApproval).toBe(true);
  });

  it('returns 400 when a required field is missing (regression guard)', async () => {
    const response = await POST(
      makeRequest({
        // Missing fullName.
        email: 'jane@example.org',
        password: 'Tr0ub4dor&3xQrSt',
        institutionName: 'Example School',
        roleId: 'principal',
        termsAcceptance: VALID_TERMS,
      }),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 when terms acceptance is missing (regression guard)', async () => {
    const response = await POST(
      makeRequest({
        ...VALID_BASE,
        password: 'Tr0ub4dor&3xQrSt',
        termsAcceptance: undefined,
      }),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
