/**
 * @vitest-environment node
 *
 * PRC-M133: the LMS file proxy validates the id, requires a session, mints a
 * signed download token when none is supplied, and streams the object.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSessionContext = vi.fn();
vi.mock('@/lib/api/gateway', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/gateway')>('@/lib/api/gateway');
  return { ...actual, getSessionContext: (...a: unknown[]) => getSessionContext(...a) };
});

import { GET } from './route';

const ORIGINAL_FETCH = global.fetch;
const ID = '11111111-2222-3333-4444-555555555555';

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function req(url = `https://app/api/lms/files/${ID}`): Request {
  return new Request(url);
}

beforeEach(() => {
  getSessionContext.mockReset().mockResolvedValue({ tenantId: 't-1', accessToken: 'tok' });
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('GET /api/lms/files/[id] (PRC-M133)', () => {
  it('rejects a non-uuid id with 400', async () => {
    const res = await GET(req('https://app/api/lms/files/not-a-uuid'), ctx('not-a-uuid'));
    expect(res.status).toBe(400);
  });

  it('returns 401 without a session token', async () => {
    getSessionContext.mockResolvedValue({ tenantId: 't-1', accessToken: null });
    const res = await GET(req(), ctx(ID));
    expect(res.status).toBe(401);
  });

  it('mints a signed token then streams the object', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'signed-tok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('BINARY', {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        }),
      );
    global.fetch = fetchSpy as unknown as typeof fetch;
    const res = await GET(req(), ctx(ID));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    // first call signs, second downloads with the minted token
    expect(fetchSpy.mock.calls[0]![0]).toContain(`/lms/files/${ID}/signed-download`);
    expect(String(fetchSpy.mock.calls[1]![0])).toContain('token=signed-tok');
  });
});
