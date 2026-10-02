/**
 * @vitest-environment node
 *
 * PRC-L076 — multipart photo upload with clear size/type errors, and no
 * 'default' tenant fallback in the BFF session context.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const cookieValues = new Map<string, string>();
let forwardedHeaders = new Headers();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieValues.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
  headers: async () => forwardedHeaders,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { gatewayFetch, getSessionContext } from '@/lib/api/gateway';
import { STUDENT_PHOTO_MAX_BYTES } from '@/lib/validation/student-360-schema';
import { POST } from './route';

const ID = '11111111-1111-4111-8111-111111111111';

function token(payload: Record<string, unknown>): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

function upload(file: Blob | null, id = ID): Request {
  const form = new FormData();
  if (file) form.append('photo', file, 'photo');
  return new Request(`http://localhost/api/students/${id}/photo`, { method: 'POST', body: form });
}

const params = (id = ID) => ({ params: Promise.resolve({ id }) });

let fetchMock: Mock<(...args: unknown[]) => Promise<Response>>;
beforeEach(() => {
  cookieValues.clear();
  forwardedHeaders = new Headers();
  fetchMock = vi.fn(
    async () =>
      new Response('{"id":"p1"}', { status: 201, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('POST /api/students/:id/photo (multipart)', () => {
  beforeEach(() => cookieValues.set('access_token', token({ sub: 'u', tenantId: 'acme' })));

  it('forwards a valid photo to the gateway as base64 JSON', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const res = await POST(upload(new Blob([bytes], { type: 'image/jpeg' })), params());
    expect(res.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/api/v1/students/${ID}/photo$`));
    expect(JSON.parse(String(init.body))).toEqual({
      contentBase64: Buffer.from(bytes).toString('base64'),
      mimeType: 'image/jpeg',
    });
    expect(new Headers(init.headers).get('X-Tenant-ID')).toBe('acme');
  });

  it('rejects an oversized photo with 413 and a clear message, without calling the gateway', async () => {
    const big = new Blob([new Uint8Array(STUDENT_PHOTO_MAX_BYTES + 1)], { type: 'image/png' });
    const res = await POST(upload(big), params());
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ message: 'Photo must be 2 MB or smaller.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a declared Content-Length over the limit before reading the body', async () => {
    const req = new Request(`http://localhost/api/students/${ID}/photo`, {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=x',
        'content-length': String(10 * 1024 * 1024),
      },
      body: 'x',
    });
    const res = await POST(req, params());
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-image type with 415', async () => {
    const res = await POST(
      upload(new Blob(['<svg onload=alert(1)>'], { type: 'image/svg+xml' })),
      params(),
    );
    expect(res.status).toBe(415);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a missing file, a bad id and an anonymous caller', async () => {
    expect((await POST(upload(null), params())).status).toBe(400);
    const jpeg = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });
    expect((await POST(upload(jpeg, '../x'), params('../x'))).status).toBe(400);
    cookieValues.clear();
    expect((await POST(upload(jpeg), params())).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('getSessionContext tenant (PRC-L076)', () => {
  it('never falls back to a "default" tenant', async () => {
    expect((await getSessionContext()).tenantId).toBeNull();
  });

  it('uses the token claim, then the middleware Host header', async () => {
    forwardedHeaders = new Headers({ 'x-tenant-id': 'host-tenant' });
    expect((await getSessionContext()).tenantId).toBe('host-tenant');
    cookieValues.set('access_token', token({ sub: 'u', tenantId: 'claim-tenant' }));
    expect((await getSessionContext()).tenantId).toBe('claim-tenant');
  });

  it('gatewayFetch omits X-Tenant-ID when the tenant is unknown', async () => {
    await gatewayFetch('/students', { throwOnError: false });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).has('X-Tenant-ID')).toBe(false);
  });
});
