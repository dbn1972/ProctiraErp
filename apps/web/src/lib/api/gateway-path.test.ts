/**
 * @vitest-environment node
 *
 * PRC-L232 / PRC-L241 — no interpolated value can retarget a gateway request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ 'x-tenant-id': 'acme' }),
}));

import { gatewayFetch } from './gateway';
import { gatewayPath, isSafeGatewayPath } from './gateway-path';
import { getStudent } from './students';

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(
    async () =>
      new Response('{"id":"s1"}', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('isSafeGatewayPath', () => {
  it.each([
    '/students/11111111-1111-4111-8111-111111111111',
    '/students?search=a/b&page=2',
    '/lms/assignments/abc/submissions?pageSize=100',
    '/registrations/applications/x%20y/status',
  ])('accepts %s', (path) => expect(isSafeGatewayPath(path)).toBe(true));

  it.each([
    '/break-glass/../../plugins/plg_001/approve',
    '/students/./x',
    '/students/%2e%2e/admin',
    '/students/%2E%2E%2Fadmin',
    '/students/..%2fadmin',
    '/students/a%5cb',
    '/students/a\\b',
    '/students/%0d%0aX',
    '/students/%zz',
  ])('rejects %s', (path) => expect(isSafeGatewayPath(path)).toBe(false));
});

describe('gatewayPath', () => {
  it('encodes each value as a single component', () => {
    expect(gatewayPath`/a/${'../x'}/b/${'y?z=1'}`).toBe('/a/..%2Fx/b/y%3Fz%3D1');
  });
});

describe('gatewayFetch path guard', () => {
  it('returns a 400 without calling fetch for a traversal path', async () => {
    const result = await gatewayFetch('/students/../admin/users', { throwOnError: false });
    expect(result).toMatchObject({ ok: false, status: 400, error: { code: 'INVALID_PATH' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws by default', async () => {
    await expect(gatewayFetch('/x/%2e%2e/y')).rejects.toMatchObject({ code: 'INVALID_PATH' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lib/api helpers encode ids: "../admin" cannot add a segment and is refused', async () => {
    await getStudent('../admin').catch(() => null);
    expect(fetchMock).not.toHaveBeenCalled();
    await getStudent('a b').catch(() => null);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toMatch(/\/api\/v1\/students\/a%20b$/);
  });
});
