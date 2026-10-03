/** PRC-M101 — timetable staff loader is scoped to the institution. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { gatewayFetch } = vi.hoisted(() => ({ gatewayFetch: vi.fn() }));
vi.mock('./gateway', () => ({ gatewayFetch, GatewayError: class extends Error {} }));

import { listAllStaffResult } from './staff';

describe('listAllStaffResult', () => {
  beforeEach(() => gatewayFetch.mockReset());

  it('forwards institutionId on every page request', async () => {
    gatewayFetch.mockResolvedValue({ ok: true, status: 200, data: { data: [{ id: 's1' }] } });
    const result = await listAllStaffResult({ institutionId: 'inst-A' });
    expect(result.ok).toBe(true);
    expect(gatewayFetch.mock.calls[0]![0]).toBe('/staff?page=1&pageSize=100&institutionId=inst-A');
  });

  it('returns the failure instead of an empty list', async () => {
    gatewayFetch.mockResolvedValue({ ok: false, status: 503, error: { code: 'X' } });
    const result = await listAllStaffResult({ institutionId: 'inst-A' });
    expect(result.ok).toBe(false);
  });
});

describe('listAllStaffResult cap (PRC-M102)', () => {
  beforeEach(() => gatewayFetch.mockReset());

  it('reports truncation when 450 staff exceed the 400 cap', async () => {
    gatewayFetch.mockImplementation(async (path: string) => {
      const page = Number(/[?&]page=(\d+)/.exec(String(path))?.[1] ?? 0);
      const data = Array.from({ length: 100 }, (_, i) => ({ id: `s${page}-${i}` }));
      return { ok: true, status: 200, data: { data, meta: { totalItems: 450 } } };
    });
    const result = await listAllStaffResult({ institutionId: 'inst-A' });
    expect(result).toMatchObject({ ok: true, truncated: true, totalItems: 450 });
    expect(result.ok && result.items).toHaveLength(400);
    expect(gatewayFetch).toHaveBeenCalledTimes(4);
  });

  it('is not truncated when everything fits', async () => {
    gatewayFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: { data: [{ id: 'a' }], meta: { totalItems: 1 } },
    });
    expect(await listAllStaffResult()).toMatchObject({ ok: true, truncated: false });
  });
});

describe('listStaff type tab (PRC-M120)', () => {
  beforeEach(() => gatewayFetch.mockReset());
  it('forwards ?type= to GET /staff and omits it for ALL', async () => {
    const { listStaff } = await import('./staff');
    gatewayFetch.mockResolvedValue({ ok: true, status: 200, data: { data: [], meta: {} } });
    await listStaff({ page: 1, type: 'ON_LEAVE' });
    expect(gatewayFetch.mock.calls[0]![0]).toBe('/staff?page=1&type=ON_LEAVE');
    await listStaff({ page: 1, type: 'ALL' });
    expect(gatewayFetch.mock.calls[1]![0]).toBe('/staff?page=1');
  });
});
