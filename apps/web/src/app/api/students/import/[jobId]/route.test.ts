/**
 * PRC-H092/H093 — student import progress proxy: session required, job id
 * validated before any gateway call, encoded tenant-scoped forward, and
 * sanitized 404/403 pass-through.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ getSession: auth.getSession }));
vi.mock('@/lib/api/gateway', () => ({
  GATEWAY_BASE_URL: 'http://gw',
  GATEWAY_API_PREFIX: '/api/v1',
  getSessionContext: vi.fn(async () => ({ tenantId: 'tenant-a', accessToken: 'tok-a' })),
}));

import { GET } from './route';

const JOB = '3f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b';
const call = (jobId: string) =>
  GET(new Request(`http://web/api/students/import/${encodeURIComponent(jobId)}`), {
    params: Promise.resolve({ jobId }),
  });
const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('student import progress proxy (PRC-H092/H093)', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    auth.getSession.mockResolvedValue({ isExpired: false, user: {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 401 without a session and does not call the gateway', async () => {
    auth.getSession.mockResolvedValueOnce(null);
    const res = await call(JOB);
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toContain('no-store');
    auth.getSession.mockResolvedValueOnce({ isExpired: true, user: {} });
    expect((await call(JOB)).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['../x', 'not-a-uuid', JOB.toUpperCase(), `${JOB}/../../admin`])(
    'rejects invalid job id %s with 400 before calling the gateway',
    async (jobId) => {
      const res = await call(jobId);
      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('forwards to the encoded gateway path with auth + tenant and returns the progress JSON', async () => {
    const progress = {
      jobId: JOB,
      status: 'completed',
      totalRows: 2,
      processedRows: 2,
      progressPercent: 100,
      startedAt: '2026-01-01T00:00:00.000Z',
      result: {
        totalRows: 2,
        successCount: 2,
        errorCount: 0,
        duplicateCount: 0,
        errors: [],
        duplicates: [],
      },
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(progress, 200));
    const res = await call(JOB);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await res.json()).toEqual(progress);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`http://gw/api/v1/students/import/${encodeURIComponent(JOB)}`);
    expect(init).toMatchObject({
      cache: 'no-store',
      headers: { Authorization: 'Bearer tok-a', 'X-Tenant-ID': 'tenant-a' },
    });
  });

  it('passes through upstream 404 and 403 without leaking the gateway message', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { code: 'NOT_FOUND', message: `Import job '${JOB}' not found`, stack: 'internal' },
        404,
      ),
    );
    const notFound = await call(JOB);
    expect(notFound.status).toBe(404);
    const body = await notFound.text();
    expect(body).not.toContain('internal');
    expect(body).not.toContain(JOB);
    expect(JSON.parse(body)).toMatchObject({ code: 'NOT_FOUND' });

    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'FORBIDDEN', message: 'rbac' }, 403));
    expect((await call(JOB)).status).toBe(403);
  });

  it('maps upstream 5xx and network failures to a generic 502', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'db down at host:5432' }, 500));
    const res = await call(JOB);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('5432');
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect((await call(JOB)).status).toBe(502);
  });
});
