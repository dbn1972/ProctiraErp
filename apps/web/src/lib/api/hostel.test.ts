/**
 * @vitest-environment node
 *
 * PRC-M278 — hostel list clients follow the paged `{ data, meta }` responses.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayFetchMock = vi.fn();

vi.mock('./gateway', () => ({
  gatewayFetch: (...args: unknown[]) => gatewayFetchMock(...args),
  GATEWAY_API_PREFIX: '/api/v1',
  GATEWAY_BASE_URL: 'http://gateway.test',
  GatewayError: class extends Error {},
  getSessionContext: vi.fn(),
}));

import { listHostelAssignments, listHostelLeaves, listHostelVisitors } from './hostel';
import { MAX_API_PAGE_SIZE } from './pagination';

const TOTAL = 250;

function serve(total: number) {
  return (path: string) => {
    const query = new URLSearchParams(path.split('?')[1]);
    const page = Number(query.get('page'));
    const pageSize = Number(query.get('pageSize'));
    const start = (page - 1) * pageSize;
    const data = Array.from({ length: Math.max(0, Math.min(pageSize, total - start)) }, (_, i) => ({
      id: `row-${start + i}`,
    }));
    return Promise.resolve({
      ok: true,
      status: 200,
      data: {
        data,
        meta: { page, pageSize, totalItems: total, totalPages: Math.ceil(total / pageSize) },
      },
    });
  };
}

const cases = [
  ['listHostelAssignments', listHostelAssignments, '/hostel/assignments'],
  ['listHostelLeaves', listHostelLeaves, '/hostel/leaves'],
  ['listHostelVisitors', listHostelVisitors, '/hostel/visitors'],
] as const;

describe.each(cases)('%s (PRC-M278)', (_name, list, path) => {
  beforeEach(() => {
    gatewayFetchMock.mockReset();
  });

  it('follows meta.totalPages and concatenates every page', async () => {
    gatewayFetchMock.mockImplementation(serve(TOTAL));
    const items = await list();
    expect(items).toHaveLength(TOTAL);
    expect(items.at(-1)?.id).toBe('row-249');
    expect(gatewayFetchMock.mock.calls.map((c) => c[0])).toEqual([
      `${path}?page=1&pageSize=${MAX_API_PAGE_SIZE}`,
      `${path}?page=2&pageSize=${MAX_API_PAGE_SIZE}`,
      `${path}?page=3&pageSize=${MAX_API_PAGE_SIZE}`,
    ]);
  });

  it('returns [] when the first page fails', async () => {
    gatewayFetchMock.mockResolvedValue({ ok: false, status: 403, error: { code: 'FORBIDDEN' } });
    expect(await list()).toEqual([]);
    expect(gatewayFetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns the pages already read when a later page fails', async () => {
    const ok = serve(TOTAL);
    gatewayFetchMock
      .mockImplementationOnce(ok)
      .mockResolvedValueOnce({ ok: false, status: 500, error: { code: 'INTERNAL' } });
    const items = await list();
    expect(items).toHaveLength(MAX_API_PAGE_SIZE);
    expect(gatewayFetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops after one request when the response carries no meta', async () => {
    gatewayFetchMock.mockResolvedValue({ ok: true, status: 200, data: { data: [{ id: 'a' }] } });
    expect(await list()).toEqual([{ id: 'a' }]);
    expect(gatewayFetchMock).toHaveBeenCalledTimes(1);
  });
});
