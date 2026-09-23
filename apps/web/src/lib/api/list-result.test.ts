/**
 * @vitest-environment node
 *
 * `fetchList` — a list read that says why it has no rows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayFetchMock = vi.fn();

vi.mock('./gateway', () => ({
  gatewayFetch: (...args: unknown[]) => gatewayFetchMock(...args),
}));

import { classifyListFailure, fetchList, itemsOrEmpty } from './list-result';

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
});

describe('fetchList', () => {
  let logged: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    gatewayFetchMock.mockReset();
    logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logged.mockRestore();
    vi.clearAllMocks();
  });

  it('never sends throwOnError, so one panel cannot white-screen a dashboard', async () => {
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
