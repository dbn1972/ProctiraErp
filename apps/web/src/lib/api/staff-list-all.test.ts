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
