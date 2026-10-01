/**
 * PRC-L039 — board export download proxy: authenticated, examination-gated,
 * signed-token flow, and cross-tenant 404 pass-through.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  canAccessExaminationRoutes: vi.fn(),
}));
vi.mock('@/lib/auth/server', () => ({ getSession: auth.getSession }));
vi.mock('@/lib/auth/examination-route-guards', () => ({
  canAccessExaminationRoutes: auth.canAccessExaminationRoutes,
}));
vi.mock('@/lib/api/gateway', () => ({
  GATEWAY_BASE_URL: 'http://gw',
  GATEWAY_API_PREFIX: '/api/v1',
  getSessionContext: vi.fn(async () => ({ tenantId: 'tenant-a', accessToken: 'tok-a' })),
}));

import { GET } from './route';

const JOB = '3f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b';
const call = (jobId: string, query = '') =>
  GET(new Request(`http://web/api/examinations/board-exports/${jobId}/download${query}`), {
    params: Promise.resolve({ jobId }),
  });

describe('board export download proxy (PRC-L039)', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    auth.getSession.mockResolvedValue({ isExpired: false, user: {} });
    auth.canAccessExaminationRoutes.mockReturnValue(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects malformed ids without calling the gateway', async () => {
    const res = await call('../x');
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a session and examination access', async () => {
    auth.getSession.mockResolvedValueOnce(null);
    expect((await call(JOB)).status).toBe(401);
    auth.canAccessExaminationRoutes.mockReturnValueOnce(false);
    expect((await call(JOB)).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 for another tenant's job id", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'NOT_FOUND' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const res = await call(JOB);
    expect(res.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`http://gw/api/v1/gradebook/board-exports/${JOB}/signed-download`);
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok-a',
      'X-Tenant-ID': 'tenant-a',
    });
  });

  it('streams the artifact using the signed token', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'sig 1' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response('a,b\n', {
          status: 200,
          headers: {
            'content-type': 'text/csv',
            'content-disposition': 'attachment; filename="marksheet.csv"',
          },
        }),
      );
    const res = await call(JOB, '?format=csv');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('a,b\n');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(fetchMock.mock.calls[1]![0]).toBe(
      `http://gw/api/v1/gradebook/board-exports/${JOB}/download?format=csv&token=sig%201`,
    );
  });

  it('page links downloads and drops the DATABASE_URL hint', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../../../(dashboard)/examinations/board-exports/page.tsx'),
      'utf8',
    );
    expect(src).not.toContain('DATABASE_URL');
    expect(src).toContain('/api/examinations/board-exports/');
  });
});
