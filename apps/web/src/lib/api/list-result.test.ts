/**
 * @vitest-environment node
 *
 * `fetchList` — a list read that says why it has no rows.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

const gatewayFetchMock = vi.fn();

vi.mock('./gateway', () => ({
  gatewayFetch: (...args: unknown[]) => gatewayFetchMock(...args),
}));

import { classifyListFailure, fetchList, itemsOrEmpty, redactPath } from './list-result';

describe('classifyListFailure', () => {
  it('separates the four cases a screen has to tell apart', () => {
    expect(classifyListFailure(401)).toBe('unauthenticated');
    expect(classifyListFailure(403)).toBe('denied');
    expect(classifyListFailure(404)).toBe('missing');
    expect(classifyListFailure(500)).toBe('unavailable');
    expect(classifyListFailure(503)).toBe('unavailable');
    // A network failure surfaces as status 0 from gatewayFetch.
    expect(classifyListFailure(0)).toBe('unavailable');
  });

  it('treats 422 as a denial, matching listPhiAccessLogs in ./health', () => {
    // Two conventions for the same status in the same layer is how the original
    // confusion started.
    expect(classifyListFailure(422)).toBe('denied');
  });
});

describe('redactPath', () => {
  it('keeps the route identifiable without naming a child', () => {
    expect(redactPath('/students/8f14e45f-ceea-467a-9a1f-8d5b1a2e3c44/consents')).toBe(
      '/students/:id/consents',
    );
    expect(redactPath('/health/phi-access?studentId=8f14e45f-ceea-467a-9a1f-8d5b1a2e3c44')).toBe(
      '/health/phi-access',
    );
    expect(redactPath('/institutions/42/classes')).toBe('/institutions/:id/classes');
  });

  it('leaves a path with no identifiers alone', () => {
    expect(redactPath('/health/records')).toBe('/health/records');
  });
});

describe('fetchList', () => {
  let logged: MockInstance<Parameters<typeof console.error>, void>;

  beforeEach(() => {
    gatewayFetchMock.mockReset();
    logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logged.mockRestore();
    vi.clearAllMocks();
  });

  it('does not let a caller choose to throw, so one panel cannot white-screen a page', async () => {
    gatewayFetchMock.mockResolvedValue({ ok: true, status: 200, data: { data: [] } });
    await fetchList('/x', { next: { revalidate: 0 } });
    const [path, init] = gatewayFetchMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/x');
    expect(init['throwOnError']).toBe(false);
    // Caller options are preserved, not replaced.
    expect(init['next']).toEqual({ revalidate: 0 });
  });

  it('unwraps both envelope shapes in use', async () => {
    gatewayFetchMock.mockResolvedValue({ ok: true, status: 200, data: { data: [1, 2] } });
    await expect(fetchList<number>('/x')).resolves.toEqual({ ok: true, items: [1, 2] });

    gatewayFetchMock.mockResolvedValue({ ok: true, status: 200, data: [3] });
    await expect(fetchList<number>('/x')).resolves.toEqual({ ok: true, items: [3] });
  });

  it('carries the pagination envelope, so paginated lists can convert too', async () => {
    // Without a meta slot, call sites that show totals could not migrate and the
    // ratchet would enforce a conversion they had no path to.
    const meta = { page: 1, pageSize: 25, totalItems: 300, totalPages: 12 };
    gatewayFetchMock.mockResolvedValue({ ok: true, status: 200, data: { data: [1], meta } });
    await expect(fetchList<number>('/students')).resolves.toEqual({
      ok: true,
      items: [1],
      meta,
    });
  });

  it('does not hand back a non-array as T[]', async () => {
    // `payload?.data ?? []` returned the object, typed as T[], and the caller threw on
    // its first .length or .filter.
    gatewayFetchMock.mockResolvedValue({ ok: true, status: 200, data: { data: { nope: 1 } } });
    await expect(fetchList<number>('/x')).resolves.toEqual({ ok: true, items: [] });
  });

  it('treats an absent body as an empty success, not a failure', async () => {
    // The gateway answers 204 for "nothing applies here"; that is zero rows, not an error.
    gatewayFetchMock.mockResolvedValue({ ok: true, status: 204, data: null });
    await expect(fetchList<number>('/x')).resolves.toEqual({ ok: true, items: [] });
  });

  it('reports a denial as a denial instead of as no rows', async () => {
    gatewayFetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      data: null,
      error: { code: 'FORBIDDEN', message: 'nope' },
    });

    const result = await fetchList<number>('/health/records');

    expect(result).toEqual({ ok: false, kind: 'denied', status: 403, code: 'FORBIDDEN' });
  });

  it('leaves a trace when a list read fails', async () => {
    // Before this helper the only record of a 403 was the absence of rows on the page.
    gatewayFetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      data: null,
      error: { code: 'FORBIDDEN', message: 'nope' },
    });

    await fetchList('/health/records');

    expect(logged).toHaveBeenCalledTimes(1);
    const [message] = logged.mock.calls[0] as [string];
    expect(message).toContain('/health/records');
    expect(message).toContain('denied');
    expect(message).toContain('403');
    expect(message).toContain('FORBIDDEN');
  });

  it('does not log a student identifier', async () => {
    // The intended call sites build paths like /students/${id}/consents. Logging the
    // interpolated path would put child identifiers into server logs.
    gatewayFetchMock.mockResolvedValue({ ok: false, status: 403, data: null });
    const id = '8f14e45f-ceea-467a-9a1f-8d5b1a2e3c44';

    await fetchList(`/students/${id}/consents`);

    const [message] = logged.mock.calls[0] as [string];
    expect(message).not.toContain(id);
    expect(message).toContain('/students/:id/consents');
  });

  it('logs an expired session as a warning, not an error', async () => {
    // An expired token is routine; it must not page anyone.
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    gatewayFetchMock.mockResolvedValue({ ok: false, status: 401, data: null });

    await fetchList('/health/records');

    expect(warned).toHaveBeenCalledTimes(1);
    expect(logged).not.toHaveBeenCalled();
    warned.mockRestore();
  });

  it('omits the upstream code when the gateway supplied none', async () => {
    gatewayFetchMock.mockResolvedValue({ ok: false, status: 0, data: null });
    const result = await fetchList<number>('/x');
    expect(result).toEqual({ ok: false, kind: 'unavailable', status: 0 });
    expect(result).not.toHaveProperty('code');
  });
});

describe('itemsOrEmpty', () => {
  it('collapses a failure to an empty array for callers not yet migrated', () => {
    expect(itemsOrEmpty({ ok: true, items: [1] })).toEqual([1]);
    expect(itemsOrEmpty({ ok: false, kind: 'denied', status: 403 })).toEqual([]);
  });
});
