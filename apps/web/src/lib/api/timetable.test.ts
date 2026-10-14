/**
 * @vitest-environment node
 *
 * PRC-L075 — mocked-gateway tests for the timetable client (the client left
 * unconfirmed after prior work). Asserts request shape (method/path/body) for
 * the mutating functions, honest error surfacing for list loads, and the
 * empty-body guard on creates.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayFetch = vi.fn();
vi.mock('./gateway', async () => {
  const actual = await vi.importActual<typeof import('./gateway')>('./gateway');
  return { ...actual, gatewayFetch: (...args: unknown[]) => gatewayFetch(...args) };
});

import { GatewayError } from './gateway';
import { createBellSchedule, createPeriod, listBellSchedules } from './timetable';

function ok<T>(data: T) {
  return { ok: true, status: 200, data };
}

beforeEach(() => gatewayFetch.mockReset());

describe('timetable client (PRC-L075)', () => {
  it('listBellSchedules builds the filtered query path', async () => {
    gatewayFetch.mockResolvedValue(ok({ data: [] }));
    await listBellSchedules({ institutionId: 'inst-1', academicPeriodId: 'ap-1' });
    const path = gatewayFetch.mock.calls[0]![0] as string;
    expect(path).toContain('/timetable/bell-schedules?');
    expect(path).toContain('institutionId=inst-1');
    expect(path).toContain('academicPeriodId=ap-1');
  });

  it('listBellSchedules returns an empty list (never undefined) when the gateway omits data', async () => {
    gatewayFetch.mockResolvedValue(ok(undefined));
    const res = await listBellSchedules();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual([]);
  });

  it('createBellSchedule POSTs the input body to the collection path', async () => {
    gatewayFetch.mockResolvedValue(ok({ id: 'bs-1' }));
    await createBellSchedule({
      institutionId: 'inst-1',
      academicPeriodId: 'ap-1',
      name: 'Regular Day',
      dayPattern: 'MON-FRI',
    });
    const [path, opts] = gatewayFetch.mock.calls[0]! as [string, { method: string; json: unknown }];
    expect(path).toBe('/timetable/bell-schedules');
    expect(opts.method).toBe('POST');
    expect(opts.json).toMatchObject({ name: 'Regular Day', dayPattern: 'MON-FRI' });
  });

  it('createBellSchedule throws when the gateway returns no body', async () => {
    gatewayFetch.mockResolvedValue({ ok: true, status: 201, data: null });
    await expect(
      createBellSchedule({ institutionId: 'i', academicPeriodId: 'a', name: 'x' }),
    ).rejects.toBeInstanceOf(GatewayError);
  });

  it('createPeriod POSTs under the encoded parent bell-schedule path', async () => {
    gatewayFetch.mockResolvedValue(ok({ id: 'p-1' }));
    await createPeriod('bs 1/weird', {
      name: 'P1',
      periodOrder: 1,
      startTime: '08:00',
      endTime: '08:45',
    });
    const path = gatewayFetch.mock.calls[0]![0] as string;
    expect(path).toBe('/timetable/bell-schedules/bs%201%2Fweird/periods');
  });
});
