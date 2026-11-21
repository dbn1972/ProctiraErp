/**
 * @vitest-environment node
 *
 * PRC-L074 — list clients must not silently stop at the first 100 rows.
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

import {
  gatewayFetchAllPages,
  gatewayFetchAllPagesWithTotal,
  MAX_AUTO_PAGES,
} from './gateway-all-pages';
import { listStaffAssignments } from './staff';
import { getStudentEnrollments } from './students';

const TOTAL = 250;
const PAGE_SIZE = 100;
function serve250(path: string) {
  const query = new URLSearchParams(path.split('?')[1]);
  const page = Number(query.get('page'));
  const pageSize = Number(query.get('pageSize'));
  const start = (page - 1) * pageSize;
  const data = Array.from({ length: Math.max(0, Math.min(pageSize, TOTAL - start)) }, (_, i) => ({
    id: `row-${start + i}`,
  }));
  return Promise.resolve({
    ok: true,
    status: 200,
    data: { data, meta: { page, pageSize, totalItems: TOTAL, totalPages: 3 } },
  });
}

describe('gatewayFetchAllPages', () => {
  beforeEach(() => {
    gatewayFetchMock.mockReset();
  });

  it('returns all 250 items across 3 pages', async () => {
    gatewayFetchMock.mockImplementation(serve250);
    const items = await gatewayFetchAllPages<{ id: string }>('/things?ownerId=x');
    expect(items).toHaveLength(TOTAL);
    expect(items.at(-1)?.id).toBe('row-249');
    expect(gatewayFetchMock).toHaveBeenCalledTimes(3);
    expect(gatewayFetchMock.mock.calls.map((c) => c[0])).toEqual([
      `/things?ownerId=x&page=1&pageSize=${PAGE_SIZE}`,
      `/things?ownerId=x&page=2&pageSize=${PAGE_SIZE}`,
      `/things?ownerId=x&page=3&pageSize=${PAGE_SIZE}`,
    ]);
  });

  it('stops after one request when the response carries no meta', async () => {
    gatewayFetchMock.mockResolvedValue({ ok: true, status: 200, data: { data: [{ id: 'a' }] } });
    expect(await gatewayFetchAllPages('/things')).toEqual([{ id: 'a' }]);
    expect(gatewayFetchMock.mock.calls[0]?.[0]).toBe(`/things?page=1&pageSize=${PAGE_SIZE}`);
  });

  it('returns [] when the first page fails and caps a runaway totalPages', async () => {
    gatewayFetchMock.mockResolvedValueOnce({ ok: false, status: 503, data: null });
    expect(await gatewayFetchAllPages('/things')).toEqual([]);

    gatewayFetchMock.mockReset();
    gatewayFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { data: [{ id: 'x' }], meta: { totalPages: 10_000 } },
    });
    await gatewayFetchAllPages('/things');
    expect(gatewayFetchMock).toHaveBeenCalledTimes(MAX_AUTO_PAGES);
  });
});
// T-D2: list screens need the gateway's total, and to know when they hold fewer rows.
describe('gatewayFetchAllPagesWithTotal', () => {
  beforeEach(() => {
    gatewayFetchMock.mockReset();
  });
  it('returns every row with the gateway total', async () => {
    gatewayFetchMock.mockImplementation(serve250);
    const list = await gatewayFetchAllPagesWithTotal<{ id: string }>('/things');
    expect(list.items).toHaveLength(TOTAL);
    expect(list.totalItems).toBe(TOTAL);
    expect(list.truncated).toBe(false);
  });
  it('marks a later-page failure as truncated and keeps the true total', async () => {
    gatewayFetchMock.mockImplementation((path: string) =>
      path.includes('page=3&') ? Promise.resolve({ ok: false, status: 503 }) : serve250(path),
    );
    const list = await gatewayFetchAllPagesWithTotal<{ id: string }>('/things');
    expect(list.items).toHaveLength(200);
    expect(list.totalItems).toBe(TOTAL);
    expect(list.truncated).toBe(true);
  });
  it('marks the page cap as truncated', async () => {
    gatewayFetchMock.mockImplementation((path: string) => {
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
      return Promise.resolve({
        ok: true,
        status: 200,
        data: {
          data: [{ id: `p${page}` }],
          meta: { totalItems: MAX_AUTO_PAGES + 5, totalPages: MAX_AUTO_PAGES + 5 },
        },
      });
    });
    const list = await gatewayFetchAllPagesWithTotal('/things');
    expect(gatewayFetchMock).toHaveBeenCalledTimes(MAX_AUTO_PAGES);
    expect(list.items).toHaveLength(MAX_AUTO_PAGES);
    expect(list.totalItems).toBe(MAX_AUTO_PAGES + 5);
    expect(list.truncated).toBe(true);
  });
  it('is empty and not truncated when the first page fails', async () => {
    gatewayFetchMock.mockResolvedValue({ ok: false, status: 403, data: null });
    expect(await gatewayFetchAllPagesWithTotal('/things')).toEqual({
      items: [],
      totalItems: 0,
      truncated: false,
    });
  });
  it('falls back to the rows read when the response carries no total', async () => {
    gatewayFetchMock.mockResolvedValue({ ok: true, status: 200, data: { data: [{ id: 'a' }] } });
    expect(await gatewayFetchAllPagesWithTotal('/things')).toEqual({
      items: [{ id: 'a' }],
      totalItems: 1,
      truncated: false,
    });
  });
});

describe('detail-page list clients use every page', () => {
  beforeEach(() => {
    gatewayFetchMock.mockReset();
    gatewayFetchMock.mockImplementation(serve250);
  });

  it('listStaffAssignments returns all 250 assignments', async () => {
    expect(await listStaffAssignments('staff-1')).toHaveLength(TOTAL);
  });

  it('getStudentEnrollments returns all 250 enrolments', async () => {
    expect(await getStudentEnrollments('student-1')).toHaveLength(TOTAL);
  });
});
