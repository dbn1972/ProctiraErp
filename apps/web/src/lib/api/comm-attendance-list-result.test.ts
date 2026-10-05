/**
 * PRC-M076: attendance roster/approval queues and communication circulars,
 * delivery log and emergency lists report a load failure instead of an empty
 * list; getCircular tells 404 apart from 403/5xx.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayFetch = vi.fn();
vi.mock('./gateway', async () => {
  const actual = await vi.importActual<typeof import('./gateway')>('./gateway');
  return { ...actual, gatewayFetch: (...args: unknown[]) => gatewayFetch(...args) };
});

import { getClassRoster, listLeaveRequests, listRegularisations } from './attendance';
import { getCircular, listCirculars, listDeliveryLogs, listEmergencyBlasts } from './communication';

function fail(status: number) {
  return { ok: false, status, data: null, error: { code: 'X', message: 'x' } };
}

beforeEach(() => {
  gatewayFetch.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('list helpers on gateway 500 (PRC-M076)', () => {
  const readers: Array<[string, () => Promise<{ ok: boolean }>]> = [
    ['getClassRoster', () => getClassRoster('c', 'p', '2026-01-01')],
    ['listRegularisations', () => listRegularisations()],
    ['listLeaveRequests', () => listLeaveRequests()],
    ['listCirculars', () => listCirculars()],
    ['listDeliveryLogs', () => listDeliveryLogs()],
    ['listEmergencyBlasts', () => listEmergencyBlasts()],
  ];
  it.each(readers)('%s returns an unavailable failure, not []', async (_name, read) => {
    gatewayFetch.mockResolvedValue(fail(500));
    const result = await read();
    expect(result).toMatchObject({ ok: false, kind: 'unavailable', status: 500 });
  });

  it('empty success stays an empty list', async () => {
    gatewayFetch.mockResolvedValue({ ok: true, status: 200, data: { data: [] } });
    expect(await listCirculars()).toEqual({ ok: true, items: [] });
  });
});

describe('getCircular (PRC-M076)', () => {
  it('maps 404 to missing', async () => {
    gatewayFetch.mockResolvedValue(fail(404));
    expect(await getCircular('x')).toMatchObject({ ok: false, kind: 'missing' });
  });
  it('maps 403 to denied', async () => {
    gatewayFetch.mockResolvedValue(fail(403));
    expect(await getCircular('x')).toMatchObject({ ok: false, kind: 'denied' });
  });
  it('returns the circular on success', async () => {
    gatewayFetch.mockResolvedValue({ ok: true, status: 200, data: { id: 'c1' } });
    expect(await getCircular('c1')).toEqual({ ok: true, circular: { id: 'c1' } });
  });
});
